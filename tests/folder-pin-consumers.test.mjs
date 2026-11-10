/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

// Point at an imported/patched Firefox source tree. The methods below are the
// actual production menu/API entrypoints, with browser globals as boundaries.
const engine = process.env.ZEN_TEST_PATCHED_ROOT || path.resolve("engine");
function loadMethod(file, start, next, globals) {
  const source = readFileSync(path.join(engine, file), "utf8");
  let method = source
    .slice(source.indexOf(start), source.indexOf(next, source.indexOf(start)))
    .trim();
  method = method.slice(0, method.lastIndexOf("},") + 1);
  method = method.startsWith("async ")
    ? method.replace(/^async /, "async function ")
    : `function ${method}`;
  return vm.runInNewContext(`(${method})`, globals);
}
const contextPath = "browser/components/tabbrowser/content/tab-context-menu.js";
const extPath = "browser/components/extensions/parent/ext-tabs.js";
const available = existsSync(path.join(engine, contextPath));

function menuFixture() {
  const pinnedRoot = { index: 0, pinned: true };
  const ordinaryInsidePins = { index: 1, pinned: false };
  const lastPinnedRoot = { index: 2, pinned: true };
  const ordinaryRoot = { index: 3, pinned: false };
  const tabs = [pinnedRoot, ordinaryInsidePins, lastPinnedRoot, ordinaryRoot];
  const calls = [];
  const browser = {
    tabs,
    pinnedTabCount: 2,
    zenIsInPinnedSection: tab => tabs.indexOf(tab) < 3,
    zenPinnedBoundary: () => 3,
    addTabGroup: (items, options) => calls.push(options.insertBefore),
    TabMetrics: { userTriggeredContext() {}, METRIC_SOURCE: {} },
  };
  return { tabs, calls, browser };
}

test(
  "native context grouping uses root placement instead of individual pin count",
  { skip: !available },
  () => {
    const { tabs, calls, browser } = menuFixture();
    const move = loadMethod(
      contextPath,
      "moveTabsToNewGroup() {",
      "moveSplitViewToNewGroup() {",
      {
        gBrowser: browser,
        gTabsPanel: { hideAllTabsPanel() {} },
      }
    );
    move.call({ contextTab: tabs[2], contextTabs: [tabs[2]] });
    assert.equal(
      calls[0],
      tabs[3],
      "a group from the final pin row starts after the entire pinned root section"
    );
  }
);

test(
  "native split context grouping uses the same root boundary",
  { skip: !available },
  () => {
    const { tabs, calls, browser } = menuFixture();
    const move = loadMethod(
      contextPath,
      "moveSplitViewToNewGroup() {",
      "moveTabsToGroup(group) {",
      {
        gBrowser: browser,
        gTabsPanel: { hideAllTabsPanel() {} },
      }
    );
    move.call({ contextTab: tabs[2], contextTabs: [tabs[2]] });
    assert.equal(calls[0], tabs[3]);
  }
);

test(
  "native extension move rejects ordinary root placement within pinned rows and allows an existing folder reorder",
  { skip: !available },
  async () => {
    const folder = {};
    const tabs = [0, 1, 2, 3, 4].map(index => ({
      index,
      pinned: index !== 1 && index !== 4,
      closest: () => (index < 3 ? folder : null),
    }));
    const calls = [];
    const browser = {
      tabs,
      pinnedTabCount: 1,
      zenPinnedBoundary: () => 3,
      moveTabTo: (tab, options) => calls.push([tab, options.tabIndex]),
    };
    const window = { gBrowser: browser };
    tabs.forEach(tab => {
      tab.documentGlobal = window;
    });
    const move = loadMethod(
      extPath,
      "async move(tabIds, moveProperties) {",
      "duplicate(tabId, duplicateProperties) {",
      {
        getNativeTabsFromIDArray: ids => ids.map(id => tabs[id]),
        tabManager: { convert: tab => tab.index },
        context: {},
      }
    );
    await move([4], { windowId: null, index: 1 });
    assert.equal(
      calls.length,
      0,
      "an ordinary root tab cannot enter pinned root positions through an inaccurate pin count"
    );
    await move([1], { windowId: null, index: 0 });
    assert.equal(
      calls.length,
      1,
      "an ordinary child may reorder inside its existing pinned folder"
    );
    assert.equal(calls[0][0], tabs[1]);
    assert.equal(calls[0][1], 0);
  }
);
