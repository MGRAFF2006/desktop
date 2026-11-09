/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

async function waitForInternalTheme(browser, accent, scheme) {
  await SpecialPowers.spawn(browser, [accent, scheme], async (color, mode) => {
    await ContentTaskUtils.waitForCondition(() => {
      const style = content.document.documentElement.style;
      return (
        style.getPropertyValue("--zen-primary-color") === color &&
        style.colorScheme === mode
      );
    }, "The built-in page receives the current Zen theme preferences");
    Assert.equal(
      content.document.documentElement.style.getPropertyValue(
        "--zen-primary-color"
      ),
      color
    );
    Assert.equal(content.document.documentElement.style.colorScheme, mode);
  });
}

add_task(async function test_builtin_pages_receive_configured_theme() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.theme.accent-color", "#2468ac"],
      ["zen.view.window.scheme", 1],
    ],
  });
  try {
    for (const url of [
      "about:addons",
      "about:downloads",
      "about:logins",
      "about:preferences",
      "about:profiles",
    ]) {
      await BrowserTestUtils.withNewTab(url, async browser => {
        await waitForInternalTheme(browser, "#2468ac", "light");
      });
    }
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_open_pages_follow_theme_changes_and_navigation() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.theme.accent-color", "#2468ac"],
      ["zen.view.window.scheme", 1],
    ],
  });
  try {
    await BrowserTestUtils.withNewTab("about:addons", async first => {
      await waitForInternalTheme(first, "#2468ac", "light");
      await BrowserTestUtils.withNewTab("about:downloads", async second => {
        await waitForInternalTheme(second, "#2468ac", "light");
        await SpecialPowers.pushPrefEnv({
          set: [
            ["zen.theme.accent-color", "#ac6824"],
            ["zen.view.window.scheme", 0],
          ],
        });
        try {
          await waitForInternalTheme(first, "#ac6824", "dark");
          await waitForInternalTheme(second, "#ac6824", "dark");
          const loaded = BrowserTestUtils.browserLoaded(
            second,
            false,
            "https://example.com/"
          );
          BrowserTestUtils.loadURIString(second, "https://example.com/");
          await loaded;
          await SpecialPowers.spawn(second, [], () => {
            Assert.equal(
              content.document.documentElement.style.getPropertyValue(
                "--zen-primary-color"
              ),
              "",
              "The theme actor does not modify web pages after navigation"
            );
          });
        } finally {
          await SpecialPowers.popPrefEnv();
        }
      });
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_system_scheme_releases_the_page_override() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.view.window.scheme", 0]],
  });
  try {
    await BrowserTestUtils.withNewTab("about:downloads", async browser => {
      const accent = Services.prefs.getStringPref("zen.theme.accent-color");
      await waitForInternalTheme(browser, accent, "dark");
      await SpecialPowers.pushPrefEnv({
        set: [["zen.view.window.scheme", 2]],
      });
      try {
        await waitForInternalTheme(browser, accent, "");
      } finally {
        await SpecialPowers.popPrefEnv();
      }
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_page_info_and_library_follow_theme_preferences() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.theme.accent-color", "#2468ac"],
      ["zen.view.window.scheme", 1],
    ],
  });
  try {
    await BrowserTestUtils.withNewTab("https://example.com/", async browser => {
      for (const [url, args] of [
        ["chrome://browser/content/pageinfo/pageInfo.xhtml", { browser }],
        ["chrome://browser/content/places/places.xhtml", "AllBookmarks"],
      ]) {
        const loaded = BrowserTestUtils.domWindowOpenedAndLoaded(
          null,
          win => win.document.documentURI === url
        );
        const dialog = window.openDialog(
          url,
          "",
          "chrome,dialog=no,resizable",
          args
        );
        await loaded;
        try {
          const style = dialog.document.documentElement.style;
          Assert.equal(
            style.getPropertyValue("--zen-primary-color"),
            "#2468ac"
          );
          Assert.equal(style.colorScheme, "light");
          await SpecialPowers.pushPrefEnv({
            set: [
              ["zen.theme.accent-color", "#ac6824"],
              ["zen.view.window.scheme", 0],
            ],
          });
          try {
            Assert.equal(
              style.getPropertyValue("--zen-primary-color"),
              "#ac6824"
            );
            Assert.equal(style.colorScheme, "dark");
            await SpecialPowers.pushPrefEnv({
              set: [["zen.view.window.scheme", 2]],
            });
            try {
              Assert.equal(
                style.colorScheme,
                "",
                "System mode releases the dialog override"
              );
            } finally {
              await SpecialPowers.popPrefEnv();
            }
          } finally {
            await SpecialPowers.popPrefEnv();
          }
        } finally {
          await BrowserTestUtils.closeWindow(dialog);
        }
      }
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});
