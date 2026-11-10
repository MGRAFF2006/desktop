/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

test("sync projections preserve ordinary folder tree, empty sibling ordering, legacy pins and opt-out", () => {
  let pref = true;
  const tab = (id, groupId = null) => ({
    zenSyncId: id,
    zenWorkspace: "ws",
    pinned: false,
    groupId,
    entries: [{ url: "https://example.org/" + id }],
    index: 1,
  });
  const sidebar = {
    lastCollected: 1,
    spaces: [{ uuid: "ws" }],
    tabs: [tab("before"), tab("member", "nested"), tab("after")],
    folders: [
      {
        id: "root",
        pinned: false,
        workspaceId: "ws",
        emptyTabIds: ["placeholder-root"],
        prevSiblingInfo: { id: "before" },
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
    "before",
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
  assert.equal(result.has("member"), false);
  assert.equal(result.has("before"), false);
  assert.deepEqual(Array.from(result.get("root").data.children), [
    "empty",
    "nested",
  ]);
});
