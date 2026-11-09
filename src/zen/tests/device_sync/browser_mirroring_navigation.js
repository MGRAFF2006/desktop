/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const DELAYED_NAVIGATION =
  "https://example.com/browser/zen/tests/device_sync/delayed_navigation.sjs";

async function waitForPendingNavigation(id) {
  await TestUtils.waitForCondition(async () => {
    const response = await fetch(
      `${DELAYED_NAVIGATION}?id=${id}&action=status`
    );
    return (await response.text()) === "pending";
  }, "The server has received the remote request without sending headers");
}

async function releaseNavigation(id) {
  await fetch(`${DELAYED_NAVIGATION}?id=${id}&action=release`);
}

add_task(async function test_SlowRemoteNavigationNeverUploadsPreviousURL() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab("https://example.com/?before-slow-mirror");
  const requestId = "slow-mirror-" + Date.now();
  const remote = `${DELAYED_NAVIGATION}?id=${requestId}`;
  try {
    await collectProjections();
    ZenSpacesSyncModel.markUploaded([tab.id]);
    const projected = ZenSpacesSyncModel.projectRecord(tab.id);
    const loaded = BrowserTestUtils.browserLoaded(
      tab.linkedBrowser,
      false,
      remote
    );
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        {
          id: tab.id,
          cleartext: {
            kind: "tab",
            data: {
              ...projected.data,
              url: remote,
              title: "Remote navigation",
            },
          },
        },
      ]),
      []
    );
    await waitForPendingNavigation(requestId);
    const pending = await collectProjections();
    Assert.equal(
      tab.linkedBrowser.currentURI.spec,
      "https://example.com/?before-slow-mirror",
      "The remote response has not committed yet"
    );
    Assert.equal(
      pending.get(tab.id).data.url,
      remote,
      "The projection retains the requested remote URL during loading"
    );
    Assert.ok(
      !(tab.id in ZenSpacesSyncModel.computeChangedIDs()),
      "A fresh session collection does not re-upload the pre-navigation URL"
    );
    await releaseNavigation(requestId);
    await loaded;
    Assert.equal(
      (await collectProjections()).get(tab.id).data.url,
      remote,
      "The committed URL replaces the pending identity"
    );
  } finally {
    await releaseNavigation(requestId);
    ZenSpacesSyncModel.noteApplied(tab.id, null);
    BrowserTestUtils.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_InterruptedNavigationReleasesThePendingIdentity() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const local = "https://example.com/?before-cancelled-mirror";
  const tab = await openSyncableTab(local);
  const requestId = "cancelled-mirror-" + Date.now();
  const remote = `${DELAYED_NAVIGATION}?id=${requestId}`;
  try {
    await collectProjections();
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        tabRecord(tab.id, { pinned: false, url: remote }),
      ]),
      []
    );
    await waitForPendingNavigation(requestId);
    tab.linkedBrowser.stop();
    await TestUtils.waitForCondition(() => !tab.hasAttribute("busy"));
    Assert.equal(
      (await collectProjections()).get(tab.id).data.url,
      local,
      "Cancelling the remote load restores the actual local URL"
    );
    const next = "https://example.com/?after-cancelled-mirror";
    const loaded = BrowserTestUtils.browserLoaded(
      tab.linkedBrowser,
      false,
      next
    );
    BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, next);
    await loaded;
    Assert.equal(
      (await collectProjections()).get(tab.id).data.url,
      next,
      "Subsequent local navigation is not masked by an abandoned pending update"
    );
  } finally {
    await releaseNavigation(requestId);
    ZenSpacesSyncModel.noteApplied(tab.id, null);
    BrowserTestUtils.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_RemoteNavigationDoesNotBypassBeforeUnload() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const local = "https://example.com/?protected-mirror";
  const tab = await openSyncableTab(local);
  try {
    await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      content.addEventListener("beforeunload", event => {
        event.preventDefault();
        event.returnValue = "";
      });
    });
    await TestUtils.waitForCondition(() => tab.linkedBrowser.hasBeforeUnload);
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        tabRecord(tab.id, {
          pinned: false,
          url: "https://example.com/?remote-protected",
        }),
      ]),
      [tab.id],
      "Protected loaded tabs defer remote navigation instead of discarding a draft"
    );
    Assert.equal(tab.linkedBrowser.currentURI.spec, local);
  } finally {
    ZenSpacesSyncModel.noteApplied(tab.id, null);
    BrowserTestUtils.removeTab(tab, { skipPermitUnload: true });
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_ClosingPendingTabReleasesNavigationTracking() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await openSyncableTab(
    "https://example.com/?close-pending-mirror"
  );
  const id = tab.id;
  const requestId = "closed-mirror-" + Date.now();
  try {
    await collectProjections();
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        tabRecord(id, {
          pinned: false,
          url: `${DELAYED_NAVIGATION}?id=${requestId}`,
        }),
      ]),
      []
    );
    await waitForPendingNavigation(requestId);
    BrowserTestUtils.removeTab(tab);
    await TestUtils.waitForCondition(() => !document.getElementById(id));
    await collectProjections();
    Assert.ok(
      id in ZenSpacesSyncModel.computeChangedIDs(),
      "Closing a pending mirrored tab produces a close, not a retained navigation identity"
    );
  } finally {
    await releaseNavigation(requestId);
    ZenSpacesSyncModel.noteApplied(id, null);
    if (tab.isConnected) {
      BrowserTestUtils.removeTab(tab);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_LoadedBlankTabRetainsPendingRemoteIdentity() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  const requestId = "blank-mirror-" + Date.now();
  const remote = `${DELAYED_NAVIGATION}?id=${requestId}`;
  try {
    await collectProjections();
    const record = tabRecord(tab.id, { pinned: false, url: remote });
    delete record.cleartext.data.current;
    record.cleartext.data.icon = "";
    Assert.deepEqual(await ZenSpacesSyncApplier.applyBatch([record]), []);
    await waitForPendingNavigation(requestId);
    const pending = await collectProjections();
    Assert.equal(
      pending.get(tab.id)?.data.url,
      remote,
      "An empty previous history entry does not discard the requested remote identity"
    );
    Assert.ok(!(tab.id in ZenSpacesSyncModel.computeChangedIDs()));
  } finally {
    await releaseNavigation(requestId);
    ZenSpacesSyncModel.noteApplied(tab.id, null);
    BrowserTestUtils.removeTab(tab);
    await SpecialPowers.popPrefEnv();
  }
});
