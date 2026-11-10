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
  return vm.runInNewContext(`(class Tabbrowser {
    static isTab(item) { return !!item?.isTab; }
    static isTabGroup(item) { return !!item?.isGroup; }
    static isTabGroupLabel(item) { return !!item?.isLabel; }
    #elementIndexToTabIndex(index) { return index; }
    #handleTabMove(item, callback) { callback(); }
    ${helpers}
    ${source.slice(start, end)}
  })`);
}
function node(name, parent = null) {
  return {
    name,
    parentElement: parent,
    pinned: false,
    group: null,
    hasAttribute: () => false,
    insertBefore(item) {
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
        folder.tabs = [child];
        target.tabs = [targetChild];
        const browser = new Native();
        browser.tabs = pinned ? [child, targetChild] : [targetChild, child];
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
      }
    }
  );
}
