/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_findbar_follows_workspace_palette() {
  if (
    !matchMedia("(forced-colors: none) and (prefers-contrast: no-preference)")
      .matches
  ) {
    info("Custom chrome colors are intentionally disabled in contrast modes");
    return;
  }
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    const findbar = await gBrowser.getFindBar();
    findbar.open();
    const field = findbar.getElement("findbar-textbox");
    try {
      // Different tokens from the normal palette detect accidental fallback to
      // platform dialog colors without depending on a particular OS palette.
      findbar.style.setProperty("--zen-dialog-background", "rgb(27, 45, 63)");
      findbar.style.setProperty("--zen-colors-input-bg", "rgb(34, 56, 78)");
      findbar.style.setProperty("--zen-colors-tertiary", "rgb(45, 67, 89)");
      for (const scheme of ["light", "dark"]) {
        findbar.style.setProperty("--toolbar-color-scheme", scheme);
        Assert.equal(
          getComputedStyle(findbar).colorScheme,
          scheme,
          "The find bar uses the toolbar scheme rather than the web page scheme"
        );
        Assert.equal(
          getComputedStyle(findbar).backgroundColor,
          "rgb(27, 45, 63)",
          "The find bar uses the Zen surface token"
        );
        field.blur();
        Assert.equal(
          getComputedStyle(field).backgroundColor,
          "rgb(34, 56, 78)",
          "The idle field uses the Zen input token"
        );
        field.focus();
        Assert.equal(
          getComputedStyle(field).backgroundColor,
          "rgb(45, 67, 89)",
          "The focused field uses the Zen focus surface"
        );
        for (const [attribute, value] of [
          ["status", "notfound"],
          ["flash", "true"],
        ]) {
          field.setAttribute(attribute, value);
          Assert.notEqual(
            getComputedStyle(field).backgroundColor,
            "rgb(45, 67, 89)",
            "Search feedback remains visible over the themed field"
          );
          field.removeAttribute(attribute);
        }
      }
    } finally {
      findbar.close();
    }
  });
});

add_task(function test_ctrl_tab_uses_panel_and_focus_tokens() {
  if (
    !matchMedia("(forced-colors: none) and (prefers-contrast: no-preference)")
      .matches
  ) {
    info("Custom chrome colors are intentionally disabled in contrast modes");
    return;
  }
  const panel = ctrlTab.panel;
  const button = ctrlTab.showAllButton;
  const previousStyle = panel.getAttribute("style");
  const wasHidden = panel.hidden;
  try {
    panel.hidden = false;
    panel.style.setProperty(
      "--toolbarbutton-background-color-hover",
      "rgb(25, 50, 75)"
    );
    panel.style.setProperty("--focus-outline-color", "rgb(50, 75, 100)");
    InspectorUtils.addPseudoClassLock(button, ":focus");
    const style = getComputedStyle(button);
    Assert.equal(
      style.backgroundColor,
      "rgb(25, 50, 75)",
      "Ctrl+Tab selection uses the shared hover surface"
    );
    Assert.equal(
      style.borderTopColor,
      "rgb(50, 75, 100)",
      "Ctrl+Tab keyboard selection uses the shared focus color"
    );
    Assert.equal(
      style.textShadow,
      "none",
      "Panel text needs no hardcoded dark shadow"
    );
  } finally {
    InspectorUtils.removePseudoClassLock(button, ":focus");
    panel.hidden = wasHidden;
    if (previousStyle === null) {
      panel.removeAttribute("style");
    } else {
      panel.setAttribute("style", previousStyle);
    }
  }
});
