/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_mods_runtime_and_marketplace_are_not_shipped() {
  await gZenWorkspaces.promiseInitialized;
  Assert.ok(
    !("gZenMods" in window),
    "Browser startup does not load store mods"
  );
  Assert.ok(
    !("@mozilla.org/zen/mods-backend;1" in Cc),
    "The native mod stylesheet loader is not registered"
  );
  Assert.throws(
    () =>
      ChromeUtils.importESModule(
        "chrome://browser/content/zen-components/ZenMods.mjs",
        { global: "current" }
      ),
    /Error|NS_ERROR/,
    "The mod installer and updater are not packaged"
  );

  await BrowserTestUtils.withNewTab("about:preferences", async browser => {
    Assert.throws(
      () =>
        browser.browsingContext.currentWindowGlobal.getActor(
          "ZenModsMarketplace"
        ),
      /NotFoundError|No such JSWindowActor|ZenModsMarketplace/,
      "Web content has no privileged marketplace installation actor"
    );
    await SpecialPowers.spawn(browser, [], () => {
      const doc = content.document;
      Assert.ok(!doc.getElementById("category-zen-marketplace"));
      Assert.ok(!doc.getElementById("template-paneZenMarketplace"));
      Assert.ok(!doc.getElementById("zenThemeMarketplaceLink"));
      Assert.ok(
        doc.querySelector('moz-page-nav-button[href="about:addons"]'),
        "Firefox's normal Add-ons entry remains available"
      );
      Assert.ok(
        doc.getElementById("category-zen-looks"),
        "Native appearance settings remain available"
      );
    });
  });
});
