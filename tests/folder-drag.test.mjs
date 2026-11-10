import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

class Item {
  constructor(name, folder = false, pinned = false) {
    this.name = name;
    this.isZenFolder = folder;
    this.pinned = pinned;
    this.children = [];
    this.attributes = new Map();
    this.classList = { contains: () => false };
    if (folder) {
      this.groupContainer = new Item(`${name}-contents`);
      this.groupContainer.folder = this;
      this.insertBefore(this.groupContainer, null);
    }
  }
  get group() {
    return this.parentElement?.folder || null;
  }
  get nextSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  contains(other) {
    return this === other || this.children.some(child => child.contains(other));
  }
  insertBefore(item, anchor) {
    assert(!item.contains(this), "DOM cycle");
    if (item.parentElement)
      item.parentElement.children.splice(
        item.parentElement.children.indexOf(item),
        1
      );
    const at = anchor ? this.children.indexOf(anchor) : this.children.length;
    assert(at >= 0, "anchor belongs to destination");
    this.children.splice(at, 0, item);
    item.parentElement = this;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

function setup() {
  const workspace = new Item("workspace");
  workspace.pinnedTabsContainer = new Item("pins");
  workspace.tabsContainer = new Item("tabs");
  workspace.insertBefore(workspace.pinnedTabsContainer, null);
  workspace.insertBefore(workspace.tabsContainer, null);
  const window = { TabDragAndDrop: class {} };
  const context = vm.createContext({
    window,
    TAB_DROP_TYPE: "tab",
    gBrowser: {
      isTab: item => !!item && !item.isZenFolder && !item.label,
      isTabGroupLabel: item => !!item?.label,
      zenHandleTabMove: (_item, callback) => callback(),
      tabContainer: { _invalidateCachedTabs() {} },
    },
    gZenWorkspaces: {
      activeWorkspaceElement: workspace,
      activeWorkspace: "workspace-id",
      updateTabsContainers() {},
    },
    gZenFolders: { canDropElement: () => true },
  });
  vm.runInContext(
    readFileSync(
      new URL("../src/zen/drag-and-drop/ZenDragAndDrop.js", import.meta.url),
      "utf8"
    ),
    context
  );
  const handler = Object.create(window.ZenDragAndDrop.prototype);
  handler._setIsDraggingTabGroup = () => {};
  handler._expandGroupOnDrop = () => {};
  Object.defineProperty(handler, "_splitDropReady", { value: false });
  function drop(
    source,
    target,
    before = false,
    items = [source],
    effect = "move"
  ) {
    for (const item of items) item.documentGlobal = window;
    source._dragData = {
      dropElement: target,
      dropBefore: before,
      movingTabs: items,
    };
    return handler._handleFolderDrop({
      dataTransfer: { dropEffect: effect, mozGetDataAt: () => source },
    });
  }
  return { workspace, drop, window };
}

function label(folder) {
  return {
    label: true,
    group: folder,
    classList: { contains: () => false },
    hasAttribute: () => false,
  };
}

test("folder row interleaves regular tabs while retaining descendant pin flags", () => {
  const { workspace: w, drop } = setup();
  const first = new Item("first"),
    last = new Item("last"),
    folder = new Item("folder", true, true);
  const child = new Item("pinned child", false, true);
  folder.groupContainer.insertBefore(child, null);
  w.pinnedTabsContainer.insertBefore(folder, null);
  w.tabsContainer.insertBefore(first, null);
  w.tabsContainer.insertBefore(last, null);
  assert(drop(folder, first));
  assert.deepEqual(
    w.tabsContainer.children.map(item => item.name),
    ["first", "folder", "last"]
  );
  assert.equal(folder.pinned, false);
  assert.equal(child.pinned, true);
  assert.equal(child.parentElement, folder.groupContainer);
});

test("move normal tabs into and out of a folder without pinning", () => {
  const { workspace: w, drop } = setup();
  const folder = new Item("folder", true),
    tab = new Item("tab"),
    sibling = new Item("sibling");
  for (const item of [folder, tab, sibling])
    w.tabsContainer.insertBefore(item, null);
  assert(drop(tab, label(folder)));
  assert.equal(tab.parentElement, folder.groupContainer);
  assert.equal(tab.pinned, false);
  assert(drop(tab, sibling, true));
  assert.deepEqual(
    w.tabsContainer.children.map(item => item.name),
    ["folder", "tab", "sibling"]
  );
});

test("nest whole folders and reject dragging a parent into its own descendant", () => {
  const { workspace: w, drop } = setup();
  const parent = new Item("parent", true),
    child = new Item("child", true);
  for (const item of [parent, child]) w.tabsContainer.insertBefore(item, null);
  assert(drop(child, label(parent)));
  assert.equal(child.parentElement, parent.groupContainer);
  assert(drop(parent, label(child)), "invalid tree drop is consumed");
  assert.equal(parent.parentElement, w.tabsContainer);
  assert.equal(child.parentElement, parent.groupContainer);
});

test("multi-selection keeps input order and does not detach selected descendants", () => {
  const { workspace: w, drop } = setup();
  const a = new Item("a"),
    b = new Item("b"),
    folder = new Item("folder", true),
    child = new Item("child");
  folder.groupContainer.insertBefore(child, null);
  for (const item of [a, b, folder]) w.tabsContainer.insertBefore(item, null);
  assert(drop(folder, a, true, [folder, child]));
  assert.deepEqual(
    w.tabsContainer.children.map(item => item.name),
    ["folder", "a", "b"]
  );
  assert.equal(child.parentElement, folder.groupContainer);
});

test("pinned child leaving an ordinary folder rejoins pins without changing its flag", () => {
  const { workspace: w, drop } = setup();
  const folder = new Item("folder", true),
    child = new Item("child", false, true),
    last = new Item("last");
  folder.groupContainer.insertBefore(child, null);
  w.tabsContainer.insertBefore(folder, null);
  w.tabsContainer.insertBefore(last, null);
  assert(drop(child, last));
  assert.equal(child.parentElement, w.pinnedTabsContainer);
  assert.equal(child.pinned, true);
});

test("Ctrl-copy falls through to the native duplication path without moving originals", () => {
  const { workspace, drop } = setup();
  const folder = new Item("folder", true);
  const tab = new Item("tab");
  workspace.tabsContainer.insertBefore(folder, null);
  workspace.tabsContainer.insertBefore(tab, null);
  assert.equal(drop(tab, label(folder), false, [tab], "copy"), false);
  assert.equal(tab.parentElement, workspace.tabsContainer);
});
