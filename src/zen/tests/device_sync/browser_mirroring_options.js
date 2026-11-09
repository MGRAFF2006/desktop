/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_LegacySyncDialogOffersExplicitMirroring() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["services.sync.perDeviceEngineChoices", true],
      ["services.sync.engine.spaces", false],
      [NORMAL_TABS_PREF, true],
    ],
  });
  const url =
    "chrome://browser/content/preferences/dialogs/syncChooseWhatToSync.xhtml";
  const loaded = BrowserTestUtils.domWindowOpenedAndLoaded(
    null,
    win => win.document.documentURI === url
  );
  const { getFxAccountsSingleton } = ChromeUtils.importESModule(
    "resource://gre/modules/FxAccounts.sys.mjs"
  );
  const telemetry = getFxAccountsSingleton().telemetry;
  const originalRecord = telemetry.recordSaveSyncSettings;
  let submitted;
  telemetry.recordSaveSyncSettings = async changes => {
    submitted = changes;
  };
  const dialog = window.openDialog(url, "", "chrome,dialog=no,resizable", {});
  try {
    await loaded;
    await dialog.document.l10n.ready;
    const spaces = dialog.document.getElementById("syncEngineSpaces");
    const mirroring = dialog.document.getElementById("syncWorkspaceNormalTabs");
    Assert.ok(!spaces.checked);
    await TestUtils.waitForCondition(
      () => mirroring.disabled,
      "Mirroring requires the workspaces Sync engine"
    );
    Assert.ok(
      mirroring.checked,
      "An existing mirroring preference is preserved while the engine is off"
    );
    spaces.click();
    await TestUtils.waitForCondition(() => !mirroring.disabled);
    const description = dialog.document.querySelector(
      '[data-l10n-id="zen-settings-workspaces-mirror-description"]'
    );
    Assert.ok(
      description.textContent.trim(),
      "The dialog shows the warning that closes propagate"
    );
    spaces.click();
    await TestUtils.waitForCondition(() => mirroring.disabled);
    spaces.click();
    dialog.document.getElementById("syncChooseOptions").acceptDialog();
    Assert.ok(
      submitted?.enabledEngines.includes("spaces"),
      "Submitting per-device choices includes the workspace selection"
    );
  } finally {
    telemetry.recordSaveSyncSettings = originalRecord;
    if (!dialog.closed) await BrowserTestUtils.closeWindow(dialog);
    await SpecialPowers.popPrefEnv();
  }
});
