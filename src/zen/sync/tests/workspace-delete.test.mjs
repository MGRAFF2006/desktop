/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Compile the production delete operation, isolating only the confirmation UI
// and native workspace storage boundary. Browser.tabs is intentionally active-
// workspace-only, as in Zen's native tab strip.
const source = readFileSync(
  new URL("../ZenSpacesSyncApplier.sys.mjs", import.meta.url),
  "utf8"
);
const start = source.indexOf("  async #deleteSpaces(");
const end = source.indexOf("\n  /**", start);
function applier(syncNormalTabs) {
  return Function(
    "lazy",
    `return new class {
    ${source.slice(start, end)}
    async #confirmRemoteSpaceDelete() { return true; }
    run(win, fail) { return this.#deleteSpaces(win, [{key:"inactive",record:{id:"inactive",deleted:true}}], fail); }
  }`
  )({ syncNormalTabs });
}
function windowFixture() {
  const removed = [];
  const ordinary = {
    pinned: false,
    hasAttribute: () => false,
    getAttribute: () => "inactive",
  };
  return {
    removed,
    win: {
      gBrowser: { tabs: [] },
      gZenWorkspaces: {
        allStoredTabs: [ordinary],
        getWorkspaces: () => [{ uuid: "active" }, { uuid: "inactive" }],
        removeWorkspace: async id => removed.push(id),
      },
    },
  };
}

test("opt-out defers deleting a background workspace containing ordinary tabs", async () => {
  const { win, removed } = windowFixture();
  const failures = [];
  await applier(false).run(win, (record, error) =>
    failures.push(error.message)
  );
  assert.deepEqual(removed, []);
  assert.match(failures[0], /ordinary tabs are opted out/);
});

test("opt-in continues mirroring a workspace close including its ordinary tabs", async () => {
  const { win, removed } = windowFixture();
  await applier(true).run(win, () => assert.fail("opt-in close should apply"));
  assert.deepEqual(removed, ["inactive"]);
});
