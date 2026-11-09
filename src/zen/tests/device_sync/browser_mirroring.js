/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_MirroringOptionRefreshesCachedProjection() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, false]] });
  const tab = await openSyncableTab("https://example.com/?mirror-option");
  try {
    const before = await collectProjections();
    Assert.ok(!before.has(tab.id));
    await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
    try {
      Assert.ok(
        ZenSpacesSyncModel.projections().has(tab.id),
        "Enabling mirroring includes existing tabs without waiting for a session collection"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
    Assert.ok(
      !ZenSpacesSyncModel.projections().has(tab.id),
      "Disabling mirroring immediately stops projecting normal tabs"
    );
  } finally {
    BrowserTestUtils.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_MirroringOptionSchedulesSyncAndStopsObserving() {
  const { ZenSpacesSyncEngine } = ChromeUtils.importESModule(
    "resource:///modules/zen/ZenSpacesSync.sys.mjs"
  );
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, false]] });
  const tab = await openSyncableTab("https://example.com/?mirror-tracker");
  await collectProjections();
  const tracker = new ZenSpacesSyncEngine({})._tracker;
  tracker.onStart();
  let tracking = true;
  try {
    Services.prefs.setBoolPref(NORMAL_TABS_PREF, true);
    Assert.greater(
      tracker.score,
      0,
      "Opting in schedules an upload immediately"
    );
    tracker.onStop();
    tracking = false;
    const stoppedScore = tracker.score;
    Services.prefs.setBoolPref(NORMAL_TABS_PREF, false);
    Assert.equal(
      tracker.score,
      stoppedScore,
      "Stopped trackers release their preference observer"
    );
  } finally {
    if (tracking) {
      tracker.onStop();
    }
    BrowserTestUtils.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_RemoteNavigationUpdatesLoadedNormalTab() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const local = "https://example.com/?mirror-local";
  const remote = "https://example.com/?mirror-remote";
  const tab = await openSyncableTab(local);
  try {
    const loaded = BrowserTestUtils.browserLoaded(
      tab.linkedBrowser,
      false,
      remote
    );
    const failed = await ZenSpacesSyncApplier.applyBatch([
      tabRecord(tab.id, { pinned: false, url: remote }),
    ]);
    Assert.deepEqual(failed, []);
    await loaded;
    Assert.equal(
      tab.linkedBrowser.currentURI.spec,
      remote,
      "Loaded tabs follow remote navigation"
    );
    Assert.equal(
      gBrowser.selectedTab,
      tab,
      "Navigation keeps the same selected tab"
    );
  } finally {
    ZenSpacesSyncModel.noteApplied(tab.id, null);
    BrowserTestUtils.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_UnsupportedURLsNeverMaterializeOrNavigateTabs() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const urls = [
    "javascript:document.body.remove()",
    "chrome://browser/content/browser.xhtml",
    "file:///tmp/private-file.html",
    "data:text/html,remote-content",
    "about:preferences",
  ];
  const loaded = await openSyncableTab("https://example.com/?mirror-safe");
  const lazyId = "test-mirror-unsupported-lazy";
  try {
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        tabRecord(lazyId, {
          pinned: false,
          url: "https://example.com/?mirror-lazy",
        }),
      ]),
      []
    );
    for (const [index, url] of urls.entries()) {
      const newId = `test-mirror-unsupported-${index}`;
      Assert.deepEqual(
        await ZenSpacesSyncApplier.applyBatch([
          tabRecord(newId, { pinned: false, url }),
          tabRecord(lazyId, { pinned: false, url }),
          tabRecord(loaded.id, { pinned: false, url }),
        ]),
        [newId, lazyId, loaded.id],
        "Unsupported records fail before creation, restore or navigation"
      );
      Assert.ok(!document.getElementById(newId));
      Assert.equal(
        loaded.linkedBrowser.currentURI.spec,
        "https://example.com/?mirror-safe"
      );
      Assert.equal(
        JSON.parse(
          SessionStore.getTabState(document.getElementById(lazyId))
        ).entries.at(-1)?.url,
        "https://example.com/?mirror-lazy"
      );
    }
  } finally {
    for (const id of [lazyId, loaded.id]) {
      ZenSpacesSyncModel.noteApplied(id, null);
      const tab = document.getElementById(id);
      if (tab) {
        BrowserTestUtils.removeTab(tab);
      }
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_LocalPageDoesNotUploadOrCloseRemoteTab() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab("https://example.com/?mirror-before-local");
  const id = tab.id;
  try {
    await collectProjections();
    ZenSpacesSyncModel.markUploaded([id]);
    const loaded = BrowserTestUtils.browserLoaded(
      tab.linkedBrowser,
      false,
      "about:preferences"
    );
    BrowserTestUtils.startLoadingURIString(
      tab.linkedBrowser,
      "about:preferences"
    );
    await loaded;
    const records = await collectProjections();
    Assert.ok(
      !records.has(id),
      "Internal pages are excluded from cross-device records"
    );
    Assert.ok(
      !records.get(gZenWorkspaces.activeWorkspace).data.children.includes(id),
      "The child order contains only supported mirrored tabs"
    );
    Assert.ok(
      !(id in ZenSpacesSyncModel.computeChangedIDs()),
      "Opening a local page does not close the other device's web tab"
    );
  } finally {
    ZenSpacesSyncModel.noteApplied(id, null);
    BrowserTestUtils.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_NormalTabClosuresMirrorOnlyWhileEnabled() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab("https://example.com/?mirror-close");
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
        "Opting out keeps normal tabs independent of remote closes"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([tombstone(id)]),
      []
    );
    await TestUtils.waitForCondition(
      () => !document.getElementById(id),
      "A remote close removes a mirrored normal tab after its close animation"
    );
  } finally {
    ZenSpacesSyncModel.noteApplied(id, null);
    if (tab.isConnected) {
      BrowserTestUtils.removeTab(tab);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_LocalCloseProjectsRemoteTombstone() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab("https://example.com/?mirror-local-close");
  const id = tab.id;
  try {
    await collectProjections();
    ZenSpacesSyncModel.markUploaded([id]);
    BrowserTestUtils.removeTab(tab);
    await TestUtils.waitForCondition(() => !document.getElementById(id));
    await collectProjections();
    Assert.ok(
      id in ZenSpacesSyncModel.computeChangedIDs(),
      "Closing a mirrored tab schedules a remote deletion"
    );
    const { ZenSpacesSyncEngine } = ChromeUtils.importESModule(
      "resource:///modules/zen/ZenSpacesSync.sys.mjs"
    );
    const record = await new ZenSpacesSyncEngine({})._store.createRecord(
      id,
      "spaces"
    );
    Assert.ok(record.deleted, "The outgoing record is a Sync tombstone");
  } finally {
    ZenSpacesSyncModel.noteApplied(id, null);
    if (tab.isConnected) {
      BrowserTestUtils.removeTab(tab);
    }
    await SpecialPowers.popPrefEnv();
  }
});
