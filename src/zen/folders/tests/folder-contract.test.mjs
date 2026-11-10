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
