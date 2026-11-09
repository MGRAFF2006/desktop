/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

function devtoolsColor(doc, value) {
  const probe = doc.createElement("span");
  probe.style.color = value;
  doc.documentElement.appendChild(probe);
  const color = doc.defaultView.getComputedStyle(probe).color;
  probe.remove();
  return color;
}

add_task(async function test_devtools_keeps_its_scheme_with_zen_surfaces() {
  if (
    !matchMedia("(forced-colors: none) and (prefers-contrast: no-preference)")
      .matches
  ) {
    info("The DevTools bridge intentionally keeps platform contrast colors");
    return;
  }
  const { require } = ChromeUtils.importESModule(
    "resource://devtools/shared/loader/Loader.sys.mjs"
  );
  const { gDevTools } = require("devtools/client/framework/devtools");
  await SpecialPowers.pushPrefEnv({
    set: [
      ["devtools.theme", "light"],
      ["zen.theme.accent-color", "#3c648c"],
    ],
  });
  try {
    await BrowserTestUtils.withNewTab(
      "data:text/html,Theme test",
      async tabBrowser => {
        const tab = gBrowser.getTabForBrowser(tabBrowser);
        const toolbox = await gDevTools.showToolboxForTab(tab, "inspector");
        try {
          const docs = [toolbox.doc, toolbox.getPanel("inspector").panelDoc];
          for (const doc of docs) {
            Assert.equal(
              doc.documentElement.style.getPropertyValue("--zen-primary-color"),
              "#3c648c",
              "New DevTools documents receive the configured accent"
            );
          }
          for (const scheme of ["light", "dark"]) {
            if (scheme === "dark") {
              Services.prefs.setCharPref("devtools.theme", scheme);
            }
            await TestUtils.waitForCondition(
              () =>
                docs.every(doc =>
                  doc.documentElement.classList.contains(`theme-${scheme}`)
                ),
              `The toolbox and inspector use the selected ${scheme} theme`
            );
            const previousFocus = docs.map(doc =>
              devtoolsColor(doc, "var(--theme-focus-outline-color)")
            );
            const accent = scheme === "light" ? "#a05a32" : "#326aa0";
            Services.prefs.setStringPref("zen.theme.accent-color", accent);
            await TestUtils.waitForCondition(
              () =>
                docs.every(
                  doc =>
                    doc.documentElement.style.getPropertyValue(
                      "--zen-primary-color"
                    ) === accent
                ),
              "Open DevTools documents receive live accent preference changes"
            );
            for (const [index, doc] of docs.entries()) {
              Assert.equal(
                devtoolsColor(doc, "var(--theme-body-background)"),
                scheme === "light" ? "rgb(250, 251, 255)" : "rgb(28, 28, 28)",
                "DevTools uses Zen's neutral surface in its own selected scheme"
              );
              const root = doc.documentElement;
              Assert.notEqual(
                devtoolsColor(doc, "var(--theme-focus-outline-color)"),
                previousFocus[index],
                "Changing the configured accent repaints DevTools focus colors"
              );
              Assert.equal(
                devtoolsColor(doc, "var(--theme-focus-outline-color)"),
                devtoolsColor(doc, "var(--theme-selection-background)"),
                "Focus and selection share the readable accent treatment"
              );
              root.setAttribute("forced-colors-active", "");
              try {
                Assert.equal(
                  devtoolsColor(doc, "var(--theme-body-background)"),
                  devtoolsColor(doc, "Canvas"),
                  "High-contrast DevTools retains its system surface"
                );
                Assert.equal(
                  devtoolsColor(doc, "var(--theme-selection-background)"),
                  devtoolsColor(doc, "SelectedItem"),
                  "High-contrast DevTools retains system selection colors"
                );
              } finally {
                root.removeAttribute("forced-colors-active");
              }
            }
          }
        } finally {
          await toolbox.destroy();
        }
      }
    );
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});
