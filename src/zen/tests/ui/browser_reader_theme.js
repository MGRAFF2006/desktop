/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_reader_controls_keep_focus_and_article_palette() {
  const article =
    "https://example.com/browser/toolkit/components/reader/tests/browser/readerModeArticle.html";
  await BrowserTestUtils.withNewTab("about:blank", async browser => {
    const ready = BrowserTestUtils.waitForContentEvent(
      browser,
      "AboutReaderContentReady"
    );
    BrowserTestUtils.startLoadingURIString(
      browser,
      `about:reader?url=${encodeURIComponent(article)}`
    );
    await ready;
    await SpecialPowers.spawn(browser, [], () => {
      const doc = content.document;
      const radio = doc.querySelector('.radiorow > input[type="radio"]');
      const label = radio.nextElementSibling;
      const text = doc.querySelector(".moz-reader-content");
      const articleColor = content.getComputedStyle(text).color;
      InspectorUtils.addPseudoClassLock(radio, ":focus-visible");
      try {
        const style = content.getComputedStyle(label);
        Assert.equal(
          style.outlineStyle,
          "solid",
          "Reader keyboard focus remains visible"
        );
        Assert.equal(style.outlineWidth, "2px");
        doc.documentElement.style.setProperty("--zen-primary-color", "#8844cc");
        Assert.equal(
          content.getComputedStyle(text).color,
          articleColor,
          "The control accent does not recolor the article"
        );
      } finally {
        InspectorUtils.removePseudoClassLock(radio, ":focus-visible");
      }
    });
  });
});
