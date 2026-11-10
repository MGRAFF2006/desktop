import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Use Surfer's patched native module, or an explicitly reconstructed module.
// This compiles the production method with only native callback/DOM boundaries
// replaced, so it catches normalization and clamping defects in moveTabTo.
const path =
  process.env.ZEN_NATIVE_TABBROWSER_SOURCE ||
  new URL(
    "../engine/browser/components/tabbrowser/Tabbrowser.sys.mjs",
    import.meta.url
  );
const source = existsSync(path) ? readFileSync(path, "utf8") : null;
function nativeClass() {
  const start = source.indexOf("  moveTabTo(\n");
  const end = source.indexOf("\n  /**", start);
  const helpers = source.slice(
    source.indexOf("  zenIsInPinnedSection("),
    source.indexOf("  get _numVisiblePinTabsWithoutCollapsed()")
  );
  const method = name => {
    const begin = source.indexOf(name);
    return source.slice(begin, source.indexOf("\n  /**", begin));
  };
  return vm.runInNewContext(`(class Tabbrowser {
    static isTab(item) { return !!item?.isTab; }
    static isTabGroup(item) { return !!item?.isGroup; }
    static isTabGroupLabel(item) { return !!item?.isLabel; }
    #elementIndexToTabIndex(index) { return index; }
    #handleTabMove(item, callback) { callback(); }
    ${helpers}
    ${source.slice(start, end)}
    ${method("  moveTabBefore(")}
    ${method("  moveTabAfter(")}
    ${method("  #moveTabNextTo(\n")}
  })`);
}
function node(name, parent = null) {
  return {
    name,
    parentElement: parent,
    pinned: false,
    group: null,
    hasAttribute: () => false,
    querySelector() {
      return null;
    },
    insertBefore(item) {
      assert.notEqual(item, this, "Cannot insert a tree into itself");
      item.parentElement = this;
    },
    after(item) {
      item.parentElement = this.parentElement;
    },
  };
}
for (const label of [false, true]) {
  test(
    `native indexed ${label ? "label" : "folder"} moves respect the folder root section`,
    { skip: !source },
    () => {
      const Native = nativeClass();
      for (const pinned of [false, true]) {
        const pins = node("pins"),
          normal = node("normal");
        const folder = node("source", pinned ? pins : normal);
        Object.assign(folder, { pinned, isGroup: true, isZenFolder: true });
        const target = node("target", pinned ? normal : pins);
        Object.assign(target, {
          pinned: !pinned,
          isGroup: true,
          isZenFolder: true,
        });
        const child = node("child");
        Object.assign(child, {
          isTab: true,
          group: folder,
          index: pinned ? 0 : 1,
        });
        const targetChild = node("targetChild");
        Object.assign(targetChild, {
          isTab: true,
          group: target,
          index: pinned ? 1 : 0,
        });
        // Every real Zen folder contains at least an anchor plus its real
        // tabs. A singleton fixture misses the forward subtree offset.
        const anchor = node("anchor");
        Object.assign(anchor, {
          isTab: true,
          group: folder,
          index: pinned ? 0 : 1,
        });
        child.index = pinned ? 1 : 2;
        targetChild.index = pinned ? 2 : 0;
        folder.tabs = [anchor, child];
        target.tabs = [targetChild];
        const browser = new Native();
        browser.tabs = pinned
          ? [anchor, child, targetChild]
          : [targetChild, anchor, child];
        browser.documentGlobal = {
          gZenGlanceManager: { getTabOrGlanceParent: item => item },
          gZenWorkspaces: { activeWorkspaceStrip: normal },
        };
        browser.tabContainer = { pinnedTabsContainer: pins };
        const moving = label ? { isLabel: true, group: folder } : folder;
        browser.moveTabTo(moving, { tabIndex: targetChild.index });
        assert.equal(folder.parentElement, pinned ? pins : normal);
        assert.equal(folder.pinned, pinned);
        assert.equal(child.group, folder);
        assert.equal(anchor.group, folder);
      }
    }
  );
}

for (const [name, move] of [
  ["no index", (browser, tab) => browser.moveTabTo(tab, {})],
  ["past the end", (browser, tab) => browser.moveTabTo(tab, { tabIndex: 100 })],
  [
    "after a missing neighbour",
    (browser, tab) => browser.moveTabAfter(tab, null),
  ],
  [
    "before a missing neighbour",
    (browser, tab) => browser.moveTabBefore(tab, null),
  ],
]) {
  test(
    `native ordinary root move ${name} preserves the periphery`,
    { skip: !source },
    () => {
      const Native = nativeClass();
      const normal = {
        children: [],
        insertBefore(item, before) {
          if (item.parentElement) {
            item.parentElement.children.splice(
              item.parentElement.children.indexOf(item),
              1
            );
          }
          const index = before
            ? this.children.indexOf(before)
            : this.children.length;
          assert.ok(index >= 0);
          this.children.splice(index, 0, item);
          item.parentElement = this;
        },
      };
      normal.appendChild = item => normal.insertBefore(item, null);
      const periphery = { id: "tabbrowser-arrowscrollbox-periphery" };
      const tab = node("ordinary");
      Object.assign(tab, { isTab: true, index: 0 });
      normal.insertBefore(tab, null);
      normal.insertBefore(periphery, null);
      const browser = new Native();
      browser.tabs = [tab];
      browser.documentGlobal = {
        gZenGlanceManager: { getTabOrGlanceParent: item => item },
        gZenFolders: { canDropElement: () => true },
        gZenWorkspaces: { activeWorkspaceStrip: normal },
      };
      // The custom native tab-container hook owns root structural placement.
      browser.tabContainer = {
        pinnedTabsContainer: { children: [] },
        insertBefore: (item, before) =>
          normal.insertBefore(item, before || periphery),
        appendChild: item => normal.insertBefore(item, periphery),
      };
      move(browser, tab);
      assert.deepEqual(normal.children, [tab, periphery]);
      assert.equal(tab.parentElement, normal);
    }
  );
}
