/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_NewWindowRestoreFollowsLiveSyncPreferences() {
  const { SessionSaver } = ChromeUtils.importESModule(
    "moz-src:///browser/components/sessionstore/SessionSaver.sys.mjs"
  );
  await gZenWorkspaces.promiseInitialized;
  const tab = gBrowser.addTrustedTab("https://example.com/?local-sync-policy", {
    inBackground: true,
    createLazyBrowser: true,
  });
  const folder = gZenFolders.createFolder([tab], {
    label: "live restore policy",
    pinned: false,
    renameFolder: false,
  });
  try {
    // Exercise both directions after SessionManager and WindowSync loaded.
    for (const [enabled, pinnedOnly] of [
      [true, false],
      [true, true],
      [true, false],
      [false, false],
      [true, false],
    ]) {
      await SpecialPowers.pushPrefEnv({
        set: [
          ["zen.window-sync.enabled", enabled],
          ["zen.window-sync.sync-only-pinned-tabs", pinnedOnly],
        ],
      });
      try {
        await SessionSaver.run();
        await withNewSyncedWindow(async win => {
          await TestUtils.waitForCondition(
            () => win.document.getElementById(folder.id)?.isZenFolder,
            "the restored folder is ready for the policy assertions"
          );
          const mirror = win.document.getElementById(folder.id);
          Assert.ok(
            mirror?.isZenFolder,
            "Restore retains ordinary folder structure"
          );
          Assert.equal(
            mirror.getAttribute("zen-workspace-id"),
            folder.getAttribute("zen-workspace-id"),
            "Restore retains the folder workspace"
          );
          Assert.ok(!mirror.pinned, "The structural folder remains ordinary");
          if (!enabled || pinnedOnly) {
            Assert.ok(
              mirror.querySelector("tab[zen-empty-tab]"),
              "A real structural anchor materializes the empty folder"
            );
          }
          const rootEmpty = win.gZenWorkspaces._emptyTab;
          Assert.ok(
            rootEmpty?.hasAttribute("zen-empty-tab") && !rootEmpty.group,
            "The workspace empty tab is separate from the folder anchor"
          );
          win.gZenWorkspaces.makeSureEmptyTabIsFirst();
          Assert.equal(
            win.gZenWorkspaces._emptyTab,
            rootEmpty,
            "An existing workspace empty tab remains reusable"
          );
          const content = win.document.getElementById(tab.id);
          Assert.equal(
            !!content,
            enabled && !pinnedOnly,
            `Ordinary contents follow current policy: enabled=${enabled}, pinnedOnly=${pinnedOnly}`
          );
          if (content) {
            Assert.ok(
              !content.hasAttribute("zen-empty-tab"),
              "Shared user content is not a structural anchor"
            );
          }
        });
      } finally {
        await SpecialPowers.popPrefEnv();
      }
    }
  } finally {
    await folder.delete();
  }
});
