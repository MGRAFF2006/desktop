/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_selected_controls_use_the_zen_accent() {
  await BrowserTestUtils.withNewTab("about:preferences", async browser => {
    await SpecialPowers.spawn(browser, [], () => {
      if (content.matchMedia("(forced-colors: active)").matches) {
        return;
      }
      const doc = content.document;
      const probe = doc.createElement("span");
      doc.body.appendChild(probe);
      const color = token => {
        probe.style.color = `var(${token})`;
        return content.getComputedStyle(probe).color;
      };
      try {
        for (const scheme of ["light", "dark"]) {
          doc.documentElement.style.colorScheme = scheme;
          for (const accent of ["#2468ac", "#ac6824"]) {
            doc.documentElement.style.setProperty(
              "--zen-primary-color",
              accent
            );
            Assert.equal(
              color("--color-accent-primary-selected"),
              color("--color-accent-primary"),
              "Selected controls use the current accent instead of Firefox blue"
            );
            Assert.equal(
              color("--button-background-color-primary-selected"),
              color("--button-background-color-primary-active"),
              "Selected modern buttons retain Zen's active treatment"
            );
          }
        }
      } finally {
        probe.remove();
      }
    });
  });
});

add_task(async function test_forced_colors_keep_system_control_tokens() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.display.document_color_use", 2]],
  });
  try {
    await BrowserTestUtils.withNewTab("about:preferences", async browser => {
      await SpecialPowers.spawn(browser, [], () => {
        Assert.ok(content.matchMedia("(forced-colors: active)").matches);
        const doc = content.document;
        const probe = doc.createElement("span");
        doc.body.appendChild(probe);
        const color = value => {
          probe.style.color = value;
          return content.getComputedStyle(probe).color;
        };
        try {
          Assert.equal(
            color("var(--button-background-color)"),
            color("ButtonFace")
          );
          Assert.equal(
            color("var(--color-accent-primary-selected)"),
            color("SelectedItem")
          );
          Assert.equal(
            color("var(--focus-outline-color)"),
            color("CanvasText")
          );
          Assert.equal(color("var(--link-color)"), color("LinkText"));
        } finally {
          probe.remove();
        }
      });
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});
