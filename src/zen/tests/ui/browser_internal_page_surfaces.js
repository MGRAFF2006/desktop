/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_internal_page_surfaces_follow_zen_tokens() {
  if (
    !matchMedia("(forced-colors: none) and (prefers-contrast: no-preference)")
      .matches
  ) {
    info("Custom surfaces leave contrast modes to Firefox");
    return;
  }
  for (const url of ["about:preferences", "about:addons", "about:logins"]) {
    await BrowserTestUtils.withNewTab(url, async browser => {
      await SpecialPowers.spawn(browser, [url], pageURL => {
        const doc = content.document;
        const root = doc.documentElement;
        const probe = doc.createElement("div");
        doc.body.append(probe);
        try {
          root.style.setProperty("--zen-colors-tertiary", "rgb(20, 40, 60)");
          root.style.setProperty("--zen-dialog-background", "rgb(30, 50, 70)");
          for (const scheme of ["light", "dark"]) {
            root.style.colorScheme = scheme;
            Assert.equal(
              content.getComputedStyle(root).backgroundColor,
              "rgb(20, 40, 60)",
              `${pageURL} uses the Zen page canvas in ${scheme} mode`
            );
            for (const token of [
              "--background-color-box",
              "--card-background-color",
            ]) {
              probe.style.backgroundColor = `var(${token})`;
              Assert.equal(
                content.getComputedStyle(probe).backgroundColor,
                "rgb(30, 50, 70)",
                `${pageURL} cards and sidebars use Zen surfaces`
              );
            }
            root.setAttribute("dialogroot", "");
            Assert.equal(
              content.getComputedStyle(root).backgroundColor,
              "rgb(30, 50, 70)",
              "Dialogs use the Zen dialog surface in both schemes"
            );
            root.removeAttribute("dialogroot");
          }
        } finally {
          probe.remove();
        }
      });
    });
  }
});
