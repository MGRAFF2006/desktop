/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { gZenBoostsManager } = ChromeUtils.importESModule(
  "resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs"
);
const APPEARANCE_HOST = "example.com";

async function waitForInversion(browser, expected) {
  await TestUtils.waitForCondition(
    () => browser.browsingContext.isZenBoostsInverted === expected,
    "The native color setting should reach the page"
  );
}

async function appearancePixels(browser) {
  return SpecialPowers.spawn(browser, [], async () => {
    await new Promise(resolve => content.requestAnimationFrame(resolve));
    await new Promise(resolve => content.requestAnimationFrame(resolve));
    const canvas = content.document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.drawWindow(content, 0, 0, 100, 100, "white");
    return {
      background: Array.from(ctx.getImageData(10, 10, 1, 1).data),
      media: Array.from(ctx.getImageData(10, 60, 1, 1).data),
    };
  });
}

add_task(
  async function site_darkening_preserves_css_and_restores_after_reload() {
    await SpecialPowers.pushPrefEnv({
      set: [["zen.boosts.enabled", true]],
    });
    await BrowserTestUtils.withNewTab(HTTPS_PAGE, async browser => {
      const boost = gZenBoostsManager.createNewBoost(APPEARANCE_HOST);
      boost.boostEntry.boostData.customCSS =
        "body { outline: 3px solid red !important; }";
      boost.boostEntry.boostData.changeWasMade = true;
      gZenBoostsManager.makeBoostActiveForDomain(APPEARANCE_HOST, boost.id);
      gZenBoostsManager.saveBoostToStore(boost);
      try {
        await SpecialPowers.spawn(browser, [], () => {
          const swatch = content.document.createElement("div");
          swatch.style.cssText =
            "position:fixed;left:0;top:0;width:100px;height:100px;background:white;z-index:2147483647";
          const media = content.document.createElement("canvas");
          media.width = 100;
          media.height = 50;
          media.style.cssText = "position:absolute;left:0;top:50px";
          const ctx = media.getContext("2d");
          ctx.fillStyle = "rgb(20, 80, 200)";
          ctx.fillRect(0, 0, 100, 50);
          swatch.appendChild(media);
          content.document.body.appendChild(swatch);
        });
        const before = await appearancePixels(browser);
        await openSiteDataPanel();
        const darken = document.getElementById("zen-site-data-darken");
        ok(!darken.disabled, "Light site darkening is available");
        EventUtils.synthesizeMouseAtCenter(darken, {});
        await waitForInversion(browser, true);
        const after = await appearancePixels(browser);
        Assert.less(
          after.background[0],
          before.background[0],
          "Native darkening darkens a painted light background"
        );
        Assert.deepEqual(
          after.media,
          before.media,
          "Native darkening preserves raster image colors"
        );
        is(
          darken.getAttribute("aria-pressed"),
          "true",
          "Toggle reports enabled state"
        );
        await SpecialPowers.pushPrefEnv({
          set: [["browser.display.document_color_use", 2]],
        });
        try {
          await waitForInversion(browser, false);
        } finally {
          await SpecialPowers.popPrefEnv();
        }
        await waitForInversion(browser, true);
        const css = boost.boostEntry.boostData.customCSS;
        await closeSiteDataPanel();
        const loaded = BrowserTestUtils.browserLoaded(browser);
        browser.reload();
        await loaded;
        await waitForInversion(browser, true);
        await openSiteDataPanel();
        EventUtils.synthesizeMouseAtCenter(darken, {});
        await waitForInversion(browser, false);
        is(
          boost.boostEntry.boostData.customCSS,
          css,
          "Disabling darkening keeps custom CSS"
        );
        const reloaded = BrowserTestUtils.browserLoaded(browser);
        await closeSiteDataPanel();
        browser.reload();
        await reloaded;
        await waitForInversion(browser, false);
        is(
          gZenBoostsManager.getActiveBoostId(APPEARANCE_HOST),
          boost.id,
          "Turning off darkening keeps the site's other saved edits active"
        );
      } finally {
        await closeSiteDataPanel();
        gZenBoostsManager.deleteBoost(boost);
      }
    });
  }
);

add_task(async function site_panel_opens_existing_css_directly() {
  await BrowserTestUtils.withNewTab(HTTPS_PAGE, async browser => {
    const boost = gZenBoostsManager.createNewBoost(APPEARANCE_HOST);
    const css = "body { outline: 4px solid blue !important; }";
    boost.boostEntry.boostData.customCSS = css;
    boost.boostEntry.boostData.changeWasMade = true;
    gZenBoostsManager.makeBoostActiveForDomain(APPEARANCE_HOST, boost.id);
    gZenBoostsManager.saveBoostToStore(boost);
    let editor;
    try {
      await openSiteDataPanel();
      const opened = BrowserTestUtils.domWindowOpened();
      EventUtils.synthesizeMouseAtCenter(
        document.getElementById("zen-site-data-custom-css"),
        {}
      );
      editor = await opened;
      await BrowserTestUtils.waitForEvent(editor, "load");
      await TestUtils.waitForCondition(
        () =>
          editor.boostEditor?.codeEditorReady &&
          editor.document.documentElement.getAttribute("editor") === "code"
      );
      is(
        editor.document.documentElement.getAttribute("editor"),
        "code",
        "The site action opens the CSS view directly"
      );
      is(
        editor._editor.getText(),
        css,
        "The CSS editor loads existing site styles"
      );
      editor._editor.setText(css + "\nbody { outline-width: 6px !important; }");
      await TestUtils.waitForCondition(
        async () =>
          SpecialPowers.spawn(
            browser,
            [],
            () =>
              content.getComputedStyle(content.document.body).outlineWidth ===
              "6px"
          ),
        "Editing CSS from the panel updates the rendered page"
      );
      is(
        boost.boostEntry.boostData.customCSS,
        editor._editor.getText(),
        "CSS edits update the active site Boost"
      );
    } finally {
      if (editor && !editor.closed) {
        const closed = BrowserTestUtils.windowClosed(editor);
        editor.close();
        await closed;
      }
      await closeSiteDataPanel();
      gZenBoostsManager.deleteBoost(boost);
    }
  });
});

add_task(async function private_pages_do_not_apply_or_edit_saved_styles() {
  const boost = gZenBoostsManager.createNewBoost(APPEARANCE_HOST);
  boost.boostEntry.boostData.customCSS =
    "body { outline: 5px solid red !important; }";
  boost.boostEntry.boostData.smartInvert = true;
  boost.boostEntry.boostData.changeWasMade = true;
  gZenBoostsManager.makeBoostActiveForDomain(APPEARANCE_HOST, boost.id);
  gZenBoostsManager.saveBoostToStore(boost);
  const privateWindow = await BrowserTestUtils.openNewBrowserWindow({
    private: true,
  });
  try {
    await BrowserTestUtils.withNewTab(
      { gBrowser: privateWindow.gBrowser, url: HTTPS_PAGE },
      async browser => {
        const actor =
          browser.browsingContext.currentWindowGlobal.getActor("ZenBoosts");
        is(
          await actor.receiveMessage({
            name: "ZenBoost:GetBoostForDomain",
            data: APPEARANCE_HOST,
          }),
          null,
          "Private pages cannot read the persistent site's Boost"
        );
        is(
          browser.browsingContext.isZenBoostsInverted,
          false,
          "Saved inversion does not reach private pages"
        );
        is(
          gZenBoostsManager.openBoostWindow(
            privateWindow,
            boost,
            Services.io.newURI(HTTPS_PAGE)
          ),
          null,
          "Private windows cannot open a persistent CSS editor"
        );
        const panel = privateWindow.document.getElementById(
          "zen-unified-site-data-panel"
        );
        const shown = BrowserTestUtils.waitForPopupEvent(panel, "shown");
        privateWindow.gNavToolbox.setAttribute(
          "zen-has-implicit-hover",
          "true"
        );
        EventUtils.synthesizeMouseAtCenter(
          privateWindow.document.getElementById("zen-site-data-icon-button"),
          {},
          privateWindow
        );
        await shown;
        ok(
          privateWindow.document.getElementById("zen-site-data-darken")
            .disabled,
          "Private darkening control is disabled"
        );
        ok(
          privateWindow.document.getElementById("zen-site-data-custom-css")
            .disabled,
          "Private CSS control is disabled"
        );
        ok(
          !privateWindow.document.getElementById("zen-site-appearance-private")
            .hidden,
          "The private limitation is explained"
        );
        panel.hidePopup();
      }
    );
  } finally {
    await BrowserTestUtils.closeWindow(privateWindow);
    gZenBoostsManager.deleteBoost(boost);
  }
});
