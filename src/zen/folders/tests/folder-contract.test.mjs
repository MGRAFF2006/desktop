/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function manager() {
  const context = vm.createContext({
    nsZenDOMOperatedFeature: class {},
    Services: { prefs: { getIntPref: () => 5 } },
    window: {},
  });
  const source = readFileSync(
    new URL("../ZenFolders.mjs", import.meta.url),
    "utf8"
  ).replace(/^import .*;\n/m, "");
  vm.runInContext(source, context);
  return { context, folders: context.window.gZenFolders };
}

test("folder nesting rejects cycles and checks the entire moving subtree", () => {
  const { folders } = manager();
  const root = {
    isZenFolder: true,
    level: 0,
    contains: node => node === descendant,
    querySelectorAll: () => [descendant],
  };
  const descendant = { level: 2 };
  assert.equal(folders.canDropElement(root, { group: root }), false);
  assert.equal(folders.canDropElement(root, { group: descendant }), false);
  assert.equal(folders.canDropElement(root, { group: { level: 2 } }), false);
  assert.equal(folders.canDropElement(root, { group: { level: 1 } }), true);
  assert.equal(folders.canDropElement(root, {}), true);
});

test("ordinary grouping creates an unpinned anchor without pinning input tabs", () => {
  const { context, folders } = manager();
  const calls = [];
  const tab = { pinned: false, linkedBrowser: {}, hasAttribute: () => false };
  const empty = { linkedBrowser: {}, setAttribute() {} };
  const folder = {
    getAttribute: () => "space",
    tabs: [empty, tab],
    addTabs: tabs => {
      assert.equal(tabs[1], tab);
    },
    querySelector: () => ({ addEventListener() {} }),
  };
  const container = {
    querySelector: () => null,
    appendChild: value => calls.push(value),
  };
  context.gZenWorkspaces = {
    activeWorkspace: "space",
    workspaceElement: () => ({ tabsContainer: container }),
  };
  context.gBrowser = {
    addTab: (url, options) => {
      assert.equal(options.pinned, false);
      return empty;
    },
    pinTab: () => assert.fail("grouping must not pin tabs"),
    TabStateFlusher: { flush() {} },
  };
  context.gZenVerticalTabsManager = { animateItemOpen() {} };
  context.Services.scriptSecurityManager = { getSystemPrincipal() {} };
  folders._createFolderNode = options => {
    assert.equal(options.pinned, false);
    return folder;
  };
  folders.updateFolderIcon = () => {};
  assert.equal(folders.createFolder([tab, tab, null]), folder);
  assert.deepEqual(calls, [folder]);
  assert.equal(tab.pinned, false);
});

test("legacy folder pin state defaults to pinned; explicit false survives reconnect", () => {
  class Group {
    constructor() {
      this.attrs = new Map();
    }
    getAttribute(name) {
      return this.attrs.get(name);
    }
    setAttribute(name, value) {
      this.attrs.set(name, value);
    }
  }
  let Folder;
  const context = vm.createContext({
    MozTabbrowserTabGroup: Group,
    ChromeUtils: { defineESModuleGetters() {} },
    DOMParser: class {
      parseFromString() {
        return { documentElement: {} };
      }
    },
    customElements: {
      define(name, value) {
        Folder = value;
      },
    },
  });
  vm.runInContext(
    readFileSync(new URL("../ZenFolder.mjs", import.meta.url), "utf8").replace(
      "export class",
      "class"
    ),
    context
  );
  const folder = new Folder();
  assert.equal(folder.pinned, true);
  folder.pinned = false;
  assert.equal(folder.getAttribute("zen-folder-pinned"), "false");
  assert.equal(folder.pinned, false);
  folder.pinned = true;
  assert.equal(folder.pinned, true);
});

test("cross-window folder adoption preserves nesting and leaves refused source children alive", () => {
  const { context, folders } = manager();
  context.document = { getElementById: () => null };
  context.gZenWorkspaces = { activeWorkspace: "target" };
  const targets = new Map();
  folders.createFolder = (tabs, options) => {
    const folder = {
      ...options,
      children: [],
      addTabs(tabs) {
        this.children.push(...tabs);
      },
      appendChild(child) {
        this.children.push(child);
      },
    };
    targets.set(options.id, folder);
    return folder;
  };
  function source(id, children) {
    return {
      id,
      label: id,
      pinned: false,
      isZenFolder: true,
      allItems: children,
      get tabs() {
        return this.allItems.flatMap(item =>
          item.isZenFolder ? item.tabs : [item]
        );
      },
      collapsed: true,
      ownerDocument: {},
      documentGlobal: { gBrowser: {} },
      hasAttribute: () => false,
      delete() {
        this.deleted = true;
      },
    };
  }
  const tab = { id: "child", pinned: true, hasAttribute: () => false };
  const inner = source("inner", [tab]);
  const root = source("root", [inner]);
  const moves = [],
    groupMoves = [];
  context.gBrowser = {
    moveTabTo(item) {
      moves.push(item);
    },
    zenHandleTabMove(item, callback) {
      groupMoves.push(item);
      callback();
    },
    adoptTab: child => {
      inner.allItems = inner.allItems.filter(item => item !== child);
      return { ...child, pinned: false };
    },
    pinTab(tab) {
      tab.pinned = true;
    },
    unpinTab(tab) {
      tab.pinned = false;
    },
    isTabGroup: () => false,
    isTab: item => !item.isZenFolder && !targets.has(item.id),
    tabContainer: { _invalidateCachedTabs() {} },
  };
  const adopted = folders.adoptFolder(root, { tabIndex: 9 });
  assert.deepEqual(
    moves,
    [adopted],
    "only the outermost folder uses the requested root position"
  );
  assert.deepEqual(
    groupMoves,
    [targets.get("inner")],
    "adopted nested folders emit native move notifications"
  );
  assert.equal(adopted.children[0], targets.get("inner"));
  assert.equal(adopted.children[0].children[0].pinned, true);
  assert.equal(adopted.collapsed, true);
  assert.equal(root.deleted, true);
  assert.equal(inner.deleted, true);
  assert.equal(
    root.removedByAdoption,
    true,
    "source removal carries native adoption lifecycle state"
  );
  assert.equal(
    inner.saveOnWindowClose,
    false,
    "adopted subfolders are not saved as user-closed groups"
  );

  const synced = source("synced", [tab]);
  context.gBrowser.adoptTab = child => ({ ...child });
  folders.adoptFolder(synced);
  assert.equal(
    synced.deleted,
    undefined,
    "a synced counterpart must not close the source tab"
  );

  const refused = source("refused", [tab]);
  context.gBrowser.adoptTab = () => null;
  assert.throws(
    () => folders.adoptFolder(refused),
    /Could not adopt folder child/
  );
  assert.equal(refused.deleted, undefined, "refused source must not be closed");
});

test("ungrouped roots route by their own flags while nested pops retain parent order", () => {
  const { context, folders } = manager();
  const moved = [];
  function container(name) {
    return {
      querySelector: () => null,
      insertBefore(item) {
        moved.push([name, item]);
      },
    };
  }
  const pins = container("pins"),
    normal = container("normal");
  context.gZenWorkspaces = {
    activeWorkspace: "space",
    workspaceElement: () => ({
      pinnedTabsContainer: pins,
      tabsContainer: normal,
    }),
  };
  function item(pinned) {
    return { pinned, setAttribute() {}, querySelectorAll: () => [] };
  }
  const ordinary = item(false),
    pinned = item(true);
  const pinnedFolder = { parentElement: pins, getAttribute: () => "space" };
  const ordinaryFolder = { parentElement: normal, getAttribute: () => "space" };
  folders.placeUngroupedItem(ordinary, pinnedFolder);
  folders.placeUngroupedItem(pinned, ordinaryFolder);
  assert.deepEqual(moved, [
    ["normal", ordinary],
    ["pins", pinned],
  ]);
  assert.equal(ordinary.pinned, false);
  assert.equal(pinned.pinned, true);
  const nested = {
    group: { isZenFolder: true },
    before: value => moved.push(["parent", value]),
  };
  folders.placeUngroupedItem(ordinary, nested, true);
  assert.deepEqual(moved.at(-1), ["parent", ordinary]);
});
