/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_square_amber_is_reversible_and_chrome_only() {
  await SpecialPowers.pushPrefEnv({ set: [["zen.theme.square-amber", false]] });
  try {
    const background = gBrowser.selectedTab.querySelector(".tab-background");
    const originalRadius = getComputedStyle(background).borderTopLeftRadius;
    const originalScheme = getComputedStyle(
      document.documentElement
    ).colorScheme;
    await BrowserTestUtils.withNewTab(
      "data:text/html,<div id='control' style='border-radius:13px;background:white;color:black'>Website</div>",
      async browser => {
        const originalContentBackground = await SpecialPowers.spawn(
          browser,
          [],
          () =>
            content.getComputedStyle(content.document.getElementById("control"))
              .backgroundColor
        );
        await SpecialPowers.pushPrefEnv({
          set: [["zen.theme.square-amber", true]],
        });
        try {
          const selectedBackground =
            gBrowser.selectedTab.querySelector(".tab-background");
          await TestUtils.waitForCondition(
            () => getComputedStyle(selectedBackground).borderTopLeftRadius === "0px",
            "Wait for preference-driven chrome restyling"
          );
          Assert.equal(
            getComputedStyle(selectedBackground).borderTopLeftRadius,
            "0px",
            "Preset squares the selected tab, including hardcoded tab radii"
          );
          if (!matchMedia("(forced-colors: active)").matches) {
            Assert.equal(
              getComputedStyle(document.documentElement).colorScheme,
              "dark",
              "Browser chrome uses the dark scheme"
            );
            Assert.equal(
              getComputedStyle(selectedBackground).outlineColor,
              "rgb(239, 163, 79)",
              "The selected tab has an amber outline"
            );
          }
          await SpecialPowers.spawn(
            browser,
            [originalContentBackground],
            originalBackground => {
              const style = content.getComputedStyle(
                content.document.getElementById("control")
              );
              Assert.equal(
                style.borderTopLeftRadius,
                "13px",
                "Website geometry is untouched"
              );
              Assert.equal(
                style.backgroundColor,
                originalBackground,
                "Website palette is untouched"
              );
            }
          );
        } finally {
          await SpecialPowers.popPrefEnv();
        }
      }
    );
    await TestUtils.waitForCondition(
      () => getComputedStyle(background).borderTopLeftRadius === originalRadius,
      "Wait for the previous chrome geometry to return"
    );
    Assert.equal(
      getComputedStyle(background).borderTopLeftRadius,
      originalRadius,
      "Disabling the preset restores the previous tab geometry"
    );
    Assert.equal(
      getComputedStyle(document.documentElement).colorScheme,
      originalScheme,
      "Disabling the preset restores the previous chrome scheme"
    );
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});
