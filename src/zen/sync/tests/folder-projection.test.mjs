/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

for (const splitPredecessor of [false, true]) {
  test(`sync folder order survives opted-out ${splitPredecessor ? "split" : "tab"} predecessors`, () => {
    let pref = true;
    const tab = (id, groupId = null) => ({
      zenSyncId: id,
      zenWorkspace: "ws",
      pinned: false,
      groupId,
      entries: [{ url: "https://example.org/" + id }],
      index: 1,
    });
    const predecessor = splitPredecessor ? "ordinary-split" : "before";
    const sidebar = {
      lastCollected: 1,
      spaces: [{ uuid: "ws" }],
      tabs: [
        ...(splitPredecessor
          ? [tab("beforeA", "ordinary-split"), tab("beforeB", "ordinary-split")]
          : [tab("before")]),
        tab("member", "nested"),
        tab("after"),
      ],
      splitViewData: splitPredecessor
        ? [{ groupId: "ordinary-split", tabs: ["beforeA", "beforeB"] }]
        : [],
      folders: [
        ...(splitPredecessor
          ? [
              {
                id: "ordinary-split",
                splitViewGroup: true,
                pinned: false,
                workspaceId: "ws",
              },
            ]
          : []),
        {
          id: "empty-root",
          pinned: false,
          workspaceId: "ws",
          prevSiblingInfo: { id: predecessor },
        },
        {
          id: "root",
          pinned: false,
          workspaceId: "ws",
          emptyTabIds: ["placeholder-root"],
          prevSiblingInfo: { id: "empty-root" },
        },
        {
          id: "empty",
          pinned: false,
          parentId: "root",
          workspaceId: "ws",
          prevSiblingInfo: { id: "placeholder-root" },
        },
        {
          id: "nested",
          pinned: false,
          parentId: "root",
          workspaceId: "ws",
          prevSiblingInfo: { id: "empty" },
        },
        {
          id: "tail",
          pinned: false,
          workspaceId: "ws",
          prevSiblingInfo: { id: "after" },
        },
        { id: "legacy", workspaceId: "elsewhere" },
      ],
    };
    const lazyValues = {
      ZenSessionStore: { getSidebarData: () => sidebar },
      ContextualIdentityService: { getPublicIdentities: () => [] },
    };
    const context = {
      console,
      URL,
      TextEncoder,
      PathUtils: { profileDir: "/unused", join: (...a) => a.join("/") },
      Services: {
        io: {
          newURI: url => ({
            scheme: new URL(url).protocol.slice(0, -1),
            spec: url,
          }),
        },
      },
      JSONFile: class {
        constructor({ dataPostProcessor }) {
          this.data = dataPostProcessor({});
        }
        ensureDataReady() {}
        saveSoon() {}
      },
      XPCOMUtils: {
        defineLazyPreferenceGetter: (o, k) =>
          Object.defineProperty(o, k, {
            get: () => (k === "syncNormalTabs" ? pref : false),
          }),
      },
      ChromeUtils: {
        defineESModuleGetters: (o, m) =>
          Object.keys(m).forEach(k =>
            Object.defineProperty(o, k, { get: () => lazyValues[k] })
          ),
      },
    };
    let source = fs
      .readFileSync(
        new URL("../ZenSpacesSyncModel.sys.mjs", import.meta.url),
        "utf8"
      )
      .replace(/^import .*?;\n/gms, "")
      .replace(/\bexport /g, "");
    vm.createContext(context);
    vm.runInContext(source + "\nglobalThis.model=ZenSpacesSyncModel;", context);
    const check = () => {
      context.model.invalidate();
      return context.model.projections();
    };
    let result = check();
    assert.deepEqual(Array.from(result.get("ws").data.children), [
      predecessor,
      "empty-root",
      "root",
      "after",
      "tail",
    ]);
    assert.deepEqual(Array.from(result.get("root").data.children), [
      "empty",
      "nested",
    ]);
    assert.equal(result.get("root").data.pinned, false);
    assert.equal(result.get("legacy").data.pinned, true);
    assert.equal(result.get("member").data.pinned, false);
    assert.equal(result.get("member").data.folderId, "nested");
    pref = false;
    result = check();
    assert.deepEqual(
      Array.from(result.get("ws").data.children),
      ["empty-root", "root", "tail"],
      "excluding ordinary tabs keeps the relative order of remaining folders"
    );
    assert.equal(result.has("member"), false);
    for (const id of splitPredecessor
      ? ["beforeA", "beforeB", "ordinary-split"]
      : ["before"]) {
      assert.equal(
        result.has(id),
        false,
        "excluded layout identity is never uploaded"
      );
    }
    assert.deepEqual(Array.from(result.get("root").data.children), [
      "empty",
      "nested",
    ]);
  });
}
