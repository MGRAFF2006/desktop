/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_pdf_viewer_chrome_uses_zen_surfaces() {
  if (
    !matchMedia("(forced-colors: none) and (prefers-contrast: no-preference)")
      .matches
  ) {
    info("PDF viewer colors remain native in contrast modes");
    return;
  }
  await BrowserTestUtils.withNewTab("about:blank", async browser => {
    const rendered = BrowserTestUtils.waitForContentEvent(
      browser,
      "textlayerrendered",
      false,
      null,
      true
    );
    BrowserTestUtils.startLoadingURIString(
      browser,
      "https://example.com/browser/toolkit/components/pdfjs/test/file_pdfjs_test.pdf"
    );
    await rendered;
    await SpecialPowers.spawn(browser, [], () => {
      const doc = content.document;
      const root = doc.documentElement;
      const page = doc.querySelector(".page");
      const documentBackground = content.getComputedStyle(page).backgroundColor;
      root.style.setProperty("--zen-dialog-background", "rgb(20, 40, 60)");
      root.style.setProperty("--zen-colors-input-bg", "rgb(30, 50, 70)");
      for (const scheme of ["light", "dark"]) {
        root.style.colorScheme = scheme;
        Assert.equal(
          content.getComputedStyle(doc.getElementById("toolbarContainer"))
            .backgroundColor,
          "rgb(20, 40, 60)",
          "The PDF toolbar follows the Zen surface"
        );
        Assert.equal(
          content.getComputedStyle(doc.getElementById("pageNumber"))
            .backgroundColor,
          "rgb(30, 50, 70)",
          "The PDF page field follows the Zen input surface"
        );
        Assert.equal(
          content.getComputedStyle(page).backgroundColor,
          documentBackground,
          "The PDF document canvas keeps its original appearance"
        );
      }
    });
  });
});
