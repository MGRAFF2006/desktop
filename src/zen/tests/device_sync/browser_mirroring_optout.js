/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_ClosedOptedOutTabRemainsDetachedAcrossRestart() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab("https://example.com/?detached-mirror");
  const id = tab.id;
  try {
    await collectProjections();
    const remote = ZenSpacesSyncModel.projectRecord(id);
    ZenSpacesSyncModel.markUploaded([id]);
    await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, false]] });
    try {
      BrowserTestUtils.removeTab(tab);
      await TestUtils.waitForCondition(() => !document.getElementById(id));
      await collectProjections();
      Assert.ok(
        !(id in ZenSpacesSyncModel.computeChangedIDs()),
        "Closing a tab after opting out never sends a remote close"
      );
      const path = PathUtils.join(PathUtils.profileDir, "zen-spaces-sync.json");
      await TestUtils.waitForCondition(async () => {
        if (!(await IOUtils.exists(path))) {
          return false;
        }
        const saved = await IOUtils.readJSON(path);
        return (
          saved.recordKinds?.[id] === "normal-tab" &&
          saved.detachedNormalTabs?.[id]
        );
      }, "The normal-tab identity and detached state reach the persistent snapshot");
      const reloaded = new ZenSpacesSyncModel.constructor();
      Assert.ok(
        !(id in reloaded.computeChangedIDs()),
        "A fresh model reload holds the closed tab using persisted state, without the old model's in-memory guards"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
    Assert.ok(
      ZenSpacesSyncModel.getNormalTabsToFetch().includes(id),
      "Re-enabling mirroring refetches the remote tab instead of retroactively closing it"
    );
    Assert.ok(
      ZenSpacesSyncModel.needsNormalTabsResync(),
      "Skipped remote tabs are also requested through a full collection refresh"
    );
    Assert.ok(!(id in ZenSpacesSyncModel.computeChangedIDs()));
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([{ id, cleartext: remote }]),
      []
    );
    Assert.ok(
      document.getElementById(id),
      "The current remote tab is restored when refetched"
    );
    Assert.ok(
      !ZenSpacesSyncModel.getNormalTabsToFetch().includes(id),
      "Applied records release detached bookkeeping"
    );
  } finally {
    ZenSpacesSyncModel.noteApplied(id, null);
    const remaining = document.getElementById(id);
    if (remaining) {
      BrowserTestUtils.removeTab(remaining);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_RemoteDeletionDuringOptOutCannotResurrect() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab(
    "https://example.com/?deleted-while-detached"
  );
  const id = tab.id;
  try {
    await collectProjections();
    ZenSpacesSyncModel.markUploaded([id]);
    await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, false]] });
    try {
      Assert.deepEqual(
        await ZenSpacesSyncApplier.applyBatch([tombstone(id)]),
        []
      );
      Assert.ok(
        document.getElementById(id),
        "Remote closes do not disturb an opted-out device"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
    Assert.ok(
      !(await collectProjections()).has(id),
      "The detached local copy cannot resurrect a known remote deletion on re-enable"
    );
    Assert.ok(!(id in ZenSpacesSyncModel.computeChangedIDs()));
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([tombstone(id)]),
      []
    );
    await TestUtils.waitForCondition(() => !document.getElementById(id));
    Assert.ok(!ZenSpacesSyncModel.getNormalTabsToFetch().includes(id));
  } finally {
    ZenSpacesSyncModel.noteApplied(id, null);
    const remaining = document.getElementById(id);
    if (remaining) {
      BrowserTestUtils.removeTab(remaining);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_PurgedRemoteTabCannotReappearAfterRefetch() {
  const { ZenSpacesSyncEngine } = ChromeUtils.importESModule(
    "resource:///modules/zen/ZenSpacesSync.sys.mjs"
  );
  const { SyncEngine } = ChromeUtils.importESModule(
    "resource://services-sync/engines.sys.mjs"
  );
  const { SerializableSet } = ChromeUtils.importESModule(
    "resource://services-sync/util.sys.mjs"
  );
  const { sinon } = ChromeUtils.importESModule(
    "resource://testing-common/Sinon.sys.mjs"
  );
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab(
    "https://example.com/?purged-remote-mirror"
  );
  const id = tab.id;
  let fetch;
  let reconcile;
  try {
    await collectProjections();
    ZenSpacesSyncModel.markUploaded([id]);
    await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, false]] });
    try {
      Assert.deepEqual(
        await ZenSpacesSyncApplier.applyBatch([tombstone(id)]),
        []
      );
      Assert.ok(document.getElementById(id));
    } finally {
      await SpecialPowers.popPrefEnv();
    }
    const engine = new ZenSpacesSyncEngine({});
    engine.toFetch = new SerializableSet([id]);
    engine.previousFailedIn = new SerializableSet();
    reconcile = sinon.stub(SyncEngine.prototype, "_maybeReconcile").resolves({
      shouldApply: false,
      error: new Error("Invalid remote record"),
    });
    // Firefox drops retry bookkeeping after repeated failures. A fetched but
    // invalid record is still present on the server and must not close a tab.
    fetch = sinon
      .stub(SyncEngine.prototype, "_processIncoming")
      .callsFake(async function () {
        await this._maybeReconcile({ id });
        this.toFetch = new SerializableSet();
        this.previousFailedIn = new SerializableSet();
      });
    await engine._processIncoming();
    Assert.ok(
      document.getElementById(id),
      "A failed live refetch is never mistaken for a remote deletion"
    );
    Assert.ok(ZenSpacesSyncModel.getNormalTabsToFetch().includes(id));
    // A subsequent successful response that genuinely lacks the identity may
    // retire it through the real post-fetch reconciliation/applier.
    fetch.callsFake(async function () {
      this.toFetch = new SerializableSet();
    });
    await engine._processIncoming();
    await TestUtils.waitForCondition(() => !document.getElementById(id));
    Assert.ok(!ZenSpacesSyncModel.getNormalTabsToFetch().includes(id));
    Assert.ok(
      !(await collectProjections()).has(id),
      "A successful empty refetch retires the detached copy instead of resurrecting it"
    );
  } finally {
    fetch?.restore();
    reconcile?.restore();
    ZenSpacesSyncModel.noteApplied(id, null);
    const remaining = document.getElementById(id);
    if (remaining) {
      BrowserTestUtils.removeTab(remaining);
    }
    await SpecialPowers.popPrefEnv();
  }
});
