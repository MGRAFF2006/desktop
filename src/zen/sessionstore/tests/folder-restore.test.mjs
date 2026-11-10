/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function fixture() {
  return {
    tabs: [
      {
        zenSyncId: "pin",
        pinned: true,
        entries: [{ url: "https://example.org/pinned" }],
        groupId: "ordinary-child",
      },
      {
        zenSyncId: "parent-anchor",
        zenIsEmpty: true,
        groupId: "ordinary-parent",
        entries: [],
      },
      {
        zenSyncId: "child-anchor",
        zenIsEmpty: true,
        groupId: "ordinary-child",
        entries: [],
      },
      {
        zenSyncId: "ordinary-content",
        groupId: "ordinary-child",
        entries: [{ url: "https://example.org/private" }],
      },
      {
        zenSyncId: "loose-content",
        entries: [{ url: "https://example.org/local" }],
      },
      {
        zenSyncId: "stray-empty",
        zenIsEmpty: true,
        groupId: "unrelated-group",
        entries: [],
      },
      {
        zenSyncId: "split-anchor",
        zenIsEmpty: true,
        groupId: "ordinary-split",
        entries: [],
      },
    ],
    folders: [
      { id: "ordinary-parent", pinned: false },
      { id: "ordinary-child", parentId: "ordinary-parent", pinned: false },
      { id: "ordinary-split", splitViewGroup: true, pinned: false },
    ],
    groups: [
      { id: "ordinary-parent", pinned: false },
      { id: "ordinary-child", pinned: false },
      { id: "ordinary-split", pinned: false },
      { id: "unrelated-group", pinned: false },
    ],
  };
}

function manager({ resume = false, windowSync = true } = {}) {
  const values = {
    gWindowSyncEnabled: windowSync,
    gSyncOnlyPinnedTabs: true,
    PrivateBrowsingUtils: { permanentPrivateBrowsing: false },
    SessionStartup: { previousSessionCrashed: false },
    SessionStore: { getCurrentState() {} },
  };
  const context = vm.createContext({
    console,
    Cu: { cloneInto: value => structuredClone(value) },
    Services: {
      appinfo: { platformBuildID: "same" },
      prefs: {
        getStringPref: () => "same",
        getIntPref: () => (resume ? 3 : 1),
        getBoolPref: () => false,
      },
    },
    ChromeUtils: {
      defineESModuleGetters: (object, modules) => {
        for (const name of Object.keys(modules)) {
          Object.defineProperty(object, name, { get: () => values[name] });
        }
      },
    },
    XPCOMUtils: {
      defineLazyPreferenceGetter: (object, name) => {
        object[name] = false;
      },
    },
  });
  const source = readFileSync(
    new URL("../ZenSessionManager.sys.mjs", import.meta.url),
    "utf8"
  )
    .replace(/^import .*;\n/gm, "")
    .replace(/\bexport /g, "");
  vm.runInContext(source + "\nglobalThis.manager = ZenSessionStore;", context);
  return context.manager;
}

const retained = ["pin", "parent-anchor", "child-anchor"];

function checkStructure(state) {
  assert.deepEqual(
    Array.from(state.tabs, tab => tab.zenSyncId),
    retained,
    "retain pin and structural anchors, excluding all ordinary tab contents"
  );
  assert.deepEqual(
    Array.from(state.groups, group => group.id),
    ["ordinary-parent", "ordinary-child"],
    "retain both ordinary folder groups needed for nested restore"
  );
  assert.equal(
    state.tabs[1].pinned,
    undefined,
    "an ordinary anchor is never repinned"
  );
}

test("closed-window pinned-only restore keeps nested folder scaffolding", () => {
  const state = fixture();
  manager().onRestoringClosedWindow(state);
  checkStructure(state);
});

test("default pinned-only new-window clone retains ordinary folders without their content", () => {
  const source = fixture();
  const win = {
    closed: true,
    gZenWorkspaces: { promiseInitialized: Promise.resolve() },
  };
  const session = {
    getWindowId: () => "new",
    _windows: { old: source },
    initializeWindow() {},
  };
  manager().restoreNewWindow(win, session);
  checkStructure(session._deferredInitialState.windows[0]);
});

test("startup sidebar filtering retains folder anchors while excluding ordinary contents", () => {
  const model = manager();
  Object.assign(model.getSidebarData(), fixture());
  const state = { windows: [{ tabs: [], groups: [] }] };
  model.onCrashCheckpoints(state);
  checkStructure(model.getSidebarData());
  assert.deepEqual(
    Array.from(state.windows[0].tabs, tab => tab.zenSyncId),
    retained,
    "sidebar restoration supplies structural anchors as well as pinned user tabs"
  );
});

test("resume-session merging replaces duplicate anchors and retains the target window's ordinary content", () => {
  const model = manager({ resume: true });
  Object.assign(model.getSidebarData(), fixture());
  const local = {
    ...fixture(),
    tabs: [
      {
        zenSyncId: "parent-anchor",
        zenIsEmpty: true,
        groupId: "ordinary-parent",
      },
      {
        zenSyncId: "local-only",
        entries: [{ url: "https://example.org/window-local" }],
      },
    ],
  };
  const state = { windows: [local] };
  model.onCrashCheckpoints(state);
  assert.deepEqual(
    Array.from(local.tabs, tab => tab.zenSyncId),
    [...retained, "local-only"],
    "shared anchors materialize exactly once and local ordinary contents stay local"
  );
});

test("window-sync-disabled startup retains folder scaffolding while filtering ordinary content", () => {
  const state = { windows: [fixture()] };
  manager({ windowSync: false }).onFileRead(state);
  checkStructure(state.windows[0]);
});
