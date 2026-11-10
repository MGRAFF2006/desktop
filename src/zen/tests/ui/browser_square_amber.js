/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_square_amber_is_reversible_and_chrome_only() {
  await SpecialPowers.pushPrefEnv({ set: [["zen.theme.square-amber", false]] });
  const background = gBrowser.selectedTab.querySelector(".tab-background");
  const originalRadius = getComputedStyle(background).borderTopLeftRadius;
  const originalScheme = getComputedStyle(document.documentElement).colorScheme;
  await BrowserTestUtils.withNewTab(
    "data:text/html,<div id='control' style='border-radius:13px;background:white;color:black'>Website</div>",
    async (browser) => {
      await SpecialPowers.pushPrefEnv({
        set: [["zen.theme.square-amber", true]],
      });
      try {
        const selectedBackground =
          gBrowser.selectedTab.querySelector(".tab-background");
        Assert.equal(
          getComputedStyle(selectedBackground).borderTopLeftRadius,
          "0px",
          "Preset squares the selected tab, including hardcoded tab radii",
        );
        if (!matchMedia("(forced-colors: active)").matches) {
          Assert.equal(
            getComputedStyle(document.documentElement).colorScheme,
            "dark",
            "Browser chrome uses the dark scheme",
          );
          Assert.equal(
            getComputedStyle(selectedBackground).outlineColor,
            "rgb(239, 163, 79)",
            "The selected tab has an amber outline",
          );
        }
        await SpecialPowers.spawn(browser, [], () => {
          const style = content.getComputedStyle(
            content.document.getElementById("control"),
          );
          Assert.equal(
            style.borderTopLeftRadius,
            "13px",
            "Website geometry is untouched",
          );
          Assert.equal(
            style.backgroundColor,
            "rgb(255, 255, 255)",
            "Website palette is untouched",
          );
        });
      } finally {
        await SpecialPowers.popPrefEnv();
      }
    },
  );
  Assert.equal(
    getComputedStyle(background).borderTopLeftRadius,
    originalRadius,
    "Disabling the preset restores the previous tab geometry",
  );
  Assert.equal(
    getComputedStyle(document.documentElement).colorScheme,
    originalScheme,
    "Disabling the preset restores the previous chrome scheme",
  );
  await SpecialPowers.popPrefEnv();
});
