/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const STATE_PREF = "zen.newtab.state";

async function pageRequest(browser, action, value) {
  return SpecialPowers.spawn(
    browser,
    [action, value],
    async (command, data) => {
      await ContentTaskUtils.waitForCondition(
        () => !content.document.getElementById("background")?.disabled,
        "Native page settings are ready",
      );
      return new Promise((resolve) => {
        const id = 10000;
        const doc = content.document;
        function response(event) {
          if (event.detail.id === id) {
            doc.removeEventListener("ZenNewTabResponse", response);
            resolve(event.detail);
          }
        }
        doc.addEventListener("ZenNewTabResponse", response);
        doc.dispatchEvent(
          new content.CustomEvent("ZenNewTabRequest", {
            detail: { id, action: command, value: data },
          }),
        );
      });
    },
  );
}

add_task(async function native_routes_and_safe_saved_links() {
  await SpecialPowers.pushPrefEnv({ set: [[STATE_PREF, "{}"]] });
  try {
    for (const url of ["about:newtab", "about:home"]) {
      await BrowserTestUtils.withNewTab(url, async (browser) => {
        const result = await pageRequest(browser, "save", {
          links: [
            { title: "Safe", url: "https://example.com/" },
            { title: "Script", url: "javascript:alert(1)" },
            { title: "Local", url: "file:///etc/passwd" },
            {
              title: "Privileged",
              url: "chrome://browser/content/browser.xhtml",
            },
            { title: "Credentials", url: "https://user:pass@example.com/" },
          ],
          background: "nightfall",
        });
        Assert.ok(result.ok);
        Assert.deepEqual(result.state.links, [
          { title: "Safe", url: "https://example.com/" },
        ]);
      });
    }
    await BrowserTestUtils.withNewTab("about:newtab", async (browser) => {
      await pageRequest(browser, "load");
      await SpecialPowers.spawn(browser, [], async () => {
        const doc = content.document;
        Assert.equal(doc.querySelectorAll("#links a").length, 1);
        Assert.equal(doc.documentElement.dataset.background, "nightfall");
        Assert.ok(
          !doc.getElementById("options").open,
          "Focus is optional and collapsed",
        );
        Assert.equal(
          doc.querySelector("#links a").href,
          "https://example.com/",
        );
      });
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function private_edits_neither_read_nor_write_profile_state() {
  const stored = JSON.stringify({
    links: [{ title: "Personal", url: "https://example.com/" }],
  });
  await SpecialPowers.pushPrefEnv({ set: [[STATE_PREF, stored]] });
  const win = await BrowserTestUtils.openNewBrowserWindow({ private: true });
  try {
    const tab = await BrowserTestUtils.openNewForegroundTab(
      win.gBrowser,
      "about:newtab",
    );
    const initial = await pageRequest(tab.linkedBrowser, "load");
    Assert.ok(initial.isPrivate);
    Assert.deepEqual(
      initial.state.links,
      [],
      "Private tab does not reveal saved links",
    );
    await pageRequest(tab.linkedBrowser, "save", {
      background: "daybreak",
      focus: "Private",
    });
    Assert.equal(
      Services.prefs.getStringPref(STATE_PREF),
      stored,
      "Private edits do not touch prefs",
    );
  } finally {
    await BrowserTestUtils.closeWindow(win);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function preserve_user_and_extension_overrides() {
  Assert.ok(
    !Services.prefs
      .getDefaultBranch("")
      .getBoolPref("zen.urlbar.replace-newtab"),
  );
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.urlbar.replace-newtab", true],
      ["browser.startup.homepage", "https://example.com/"],
      ["browser.newtabpage.enabled", false],
    ],
  });
  try {
    Assert.ok(
      Services.prefs.getBoolPref("zen.urlbar.replace-newtab"),
      "Explicit user pref wins",
    );
    const { HomePage } = ChromeUtils.importESModule(
      "resource:///modules/HomePage.sys.mjs",
    );
    Assert.equal(HomePage.get(), "https://example.com/");
    await BrowserTestUtils.withNewTab("about:newtab", async (browser) => {
      await SpecialPowers.spawn(browser, [], () => {
        Assert.ok(
          !content.document.getElementById("zen-start"),
          "Disabled new-tab stays blank",
        );
      });
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
  const { AboutNewTab } = ChromeUtils.importESModule(
    "resource:///modules/AboutNewTab.sys.mjs",
  );
  const extension = ExtensionTestUtils.loadExtension({
    manifest: { chrome_url_overrides: { newtab: "newtab.html" } },
    files: { "newtab.html": "<!doctype html><title>Extension new tab</title>" },
  });
  await extension.startup();
  try {
    Assert.ok(AboutNewTab.newTabURL.startsWith("moz-extension://"));
    await BrowserTestUtils.withNewTab(
      AboutNewTab.newTabURL,
      async (browser) => {
        await SpecialPowers.spawn(browser, [], () => {
          Assert.equal(content.document.title, "Extension new tab");
          Assert.ok(!content.document.getElementById("zen-start"));
        });
      },
    );
  } finally {
    await extension.unload();
  }
});

add_task(async function search_uses_the_selected_browser_engine() {
  const { SearchTestUtils } = ChromeUtils.importESModule(
    "resource://testing-common/SearchTestUtils.sys.mjs",
  );
  SearchTestUtils.init(this);
  await SearchTestUtils.installSearchExtension(
    {
      name: "Native page search test",
      search_url: "https://example.com/",
      search_url_get_params: "q={searchTerms}",
    },
    { setAsDefault: true },
  );
  await BrowserTestUtils.withNewTab("about:newtab", async (browser) => {
    await pageRequest(browser, "load");
    const loaded = BrowserTestUtils.browserLoaded(
      browser,
      false,
      "https://example.com/?q=quiet+start",
    );
    await SpecialPowers.spawn(browser, [], () => {
      content.document.getElementById("search").value = "quiet start";
      content.document.getElementById("search-form").requestSubmit();
    });
    await loaded;
    Assert.equal(browser.currentURI.spec, "https://example.com/?q=quiet+start");
  });
});
