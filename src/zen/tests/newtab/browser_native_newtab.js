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
    const edited = await pageRequest(tab.linkedBrowser, "load");
    Assert.equal(
      edited.state.focus,
      "Private",
      "Private edits last in this document",
    );
    const freshTab = await BrowserTestUtils.openNewForegroundTab(
      win.gBrowser,
      "about:home",
    );
    const fresh = await pageRequest(freshTab.linkedBrowser, "load");
    Assert.equal(
      fresh.state.focus,
      "",
      "Another private document starts clean",
    );
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
    useAddonManager: "temporary",
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
  const { SearchService } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  );
  await SearchService.init();
  const previous = await SearchService.getDefault();
  const previousPrivate = await SearchService.getDefaultPrivate();
  const privateDefaultPref = "browser.search.separatePrivateDefault.enabled";
  const hadPrivateDefaultPref =
    Services.prefs.prefHasUserValue(privateDefaultPref);
  const previousPrivateDefaultPref =
    Services.prefs.getBoolPref(privateDefaultPref);
  let normalExtension, privateExtension;
  registerCleanupFunction(async () => {
    try {
      await SearchService.setDefault(
        previous,
        SearchService.CHANGE_REASON.UNKNOWN,
      );
      await SearchService.setDefaultPrivate(
        previousPrivate,
        SearchService.CHANGE_REASON.UNKNOWN,
      );
      await privateExtension?.unload();
      await normalExtension?.unload();
    } finally {
      if (hadPrivateDefaultPref) {
        Services.prefs.setBoolPref(
          privateDefaultPref,
          previousPrivateDefaultPref,
        );
      } else {
        Services.prefs.clearUserPref(privateDefaultPref);
      }
    }
  });
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.search.separatePrivateDefault", true],
      ["browser.search.separatePrivateDefault.ui.enabled", true],
    ],
  });
  normalExtension = await SearchTestUtils.installSearchExtension(
    {
      name: "Native page search test",
      search_url: "https://example.com/",
      search_url_get_params: "q={searchTerms}",
    },
    { setAsDefault: true, skipUnload: true },
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
  privateExtension = await SearchTestUtils.installSearchExtension(
    {
      name: "Native private search test",
      search_url: "https://example.org/",
      search_url_get_params: "private={searchTerms}",
    },
    { setAsDefaultPrivate: true, skipUnload: true },
  );
  const win = await BrowserTestUtils.openNewBrowserWindow({ private: true });
  try {
    const tab = await BrowserTestUtils.openNewForegroundTab(
      win.gBrowser,
      "about:home",
    );
    const browser = tab.linkedBrowser;
    await pageRequest(browser, "load");
    const loaded = BrowserTestUtils.browserLoaded(
      browser,
      false,
      "https://example.org/?private=quiet+start",
    );
    await SpecialPowers.spawn(browser, [], () => {
      content.document.getElementById("search").value = "quiet start";
      content.document.getElementById("search-form").requestSubmit();
    });
    await loaded;
    Assert.equal(
      browser.currentURI.spec,
      "https://example.org/?private=quiet+start",
    );
  } finally {
    await BrowserTestUtils.closeWindow(win);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function keyboard_editing_and_narrow_layout() {
  await SpecialPowers.pushPrefEnv({ set: [[STATE_PREF, "{}"]] });
  try {
    await BrowserTestUtils.withNewTab("about:newtab", async (browser) => {
      await pageRequest(browser, "load");
      await SpecialPowers.spawn(browser, [], async () => {
        await content.document.l10n.ready;
        const doc = content.document;
        Assert.ok(doc.title, "Fluent title is present");
        Assert.ok(doc.getElementById("search").getAttribute("aria-label"));
        doc.getElementById("add-link").focus();
      });
      await BrowserTestUtils.synthesizeKey("KEY_Enter", {}, browser);
      await SpecialPowers.spawn(browser, [], () => {
        const doc = content.document;
        Assert.ok(doc.getElementById("link-dialog").open);
        Assert.equal(doc.activeElement.id, "link-title");
      });
      await BrowserTestUtils.synthesizeKey("KEY_Escape", {}, browser);
      await SpecialPowers.spawn(browser, [], () => {
        const doc = content.document;
        Assert.ok(!doc.getElementById("link-dialog").open);
        Assert.equal(doc.activeElement.id, "add-link", "Escape restores focus");
        doc.getElementById("add-link").click();
        doc.getElementById("link-title").value = "My link";
        doc.getElementById("link-url").value = "https://example.org/";
        doc.getElementById("link-form").requestSubmit();
      });
      await TestUtils.waitForCondition(() =>
        Services.prefs.getStringPref(STATE_PREF).includes("My link"),
      );
      const loaded = BrowserTestUtils.browserLoaded(browser);
      browser.reload();
      await loaded;
      await pageRequest(browser, "load");
      await SpecialPowers.spawn(browser, [], () => {
        const doc = content.document;
        Assert.equal(doc.querySelector("#links a").textContent, "My link");
      });
      browser.style.minWidth = "320px";
      browser.style.maxWidth = "320px";
      await SpecialPowers.spawn(browser, [], async () => {
        await ContentTaskUtils.waitForCondition(
          () => content.innerWidth === 320,
        );
        const doc = content.document;
        Assert.equal(
          doc.documentElement.scrollWidth,
          doc.documentElement.clientWidth,
          "Default page fits a narrow viewport",
        );
        doc.getElementById("options").open = true;
        Assert.equal(
          doc.documentElement.scrollWidth,
          doc.documentElement.clientWidth,
          "Customize fits a narrow viewport",
        );
        doc.getElementById("add-link").click();
        Assert.equal(
          doc.documentElement.scrollWidth,
          doc.documentElement.clientWidth,
          "Link dialog fits a narrow viewport",
        );
      });
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function stale_documents_keep_newer_saved_links() {
  await SpecialPowers.pushPrefEnv({ set: [[STATE_PREF, "{}"]] });
  const tabs = [];
  const edit = (browser, kind) =>
    SpecialPowers.spawn(browser, [kind], async (action) => {
      const doc = content.document;
      const response = new Promise((resolve) => {
        doc.addEventListener(
          "ZenNewTabResponse",
          (event) => resolve(event.detail),
          { once: true },
        );
      });
      if (action === "link") {
        doc.getElementById("add-link").click();
        doc.getElementById("link-title").value = "Saved in first page";
        doc.getElementById("link-url").value = "https://example.com/";
        doc.getElementById("link-form").requestSubmit();
      } else {
        const clock = doc.getElementById("clock-format");
        clock.value = "24";
        clock.dispatchEvent(new content.Event("change", { bubbles: true }));
      }
      return response;
    });
  try {
    for (const url of ["about:newtab", "about:home"]) {
      const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
      tabs.push(tab);
      await pageRequest(tab.linkedBrowser, "load");
    }
    const [first, second] = tabs.map((tab) => tab.linkedBrowser);
    Assert.ok((await edit(first, "link")).ok, "First page saves a link");
    second.style.minWidth = "320px";
    second.style.maxWidth = "320px";
    const stale = await edit(second, "clock");
    Assert.ok(
      !stale.ok,
      "The stale page does not report a successful overwrite",
    );
    Assert.equal(
      JSON.parse(Services.prefs.getStringPref(STATE_PREF)).links[0]?.title,
      "Saved in first page",
      "Changing the stale clock cannot delete newer quicklinks",
    );
    const loaded = BrowserTestUtils.browserLoaded(second);
    await SpecialPowers.spawn(second, [], async () => {
      await ContentTaskUtils.waitForCondition(() => content.innerWidth === 320);
      const doc = content.document;
      await doc.l10n.ready;
      Assert.equal(
        doc.documentElement.scrollWidth,
        doc.documentElement.clientWidth,
        "Conflict recovery fits a narrow viewport",
      );
      const reload = doc.getElementById("reload-page");
      Assert.ok(
        reload?.textContent,
        "The recovery action has a localized name",
      );
      Assert.equal(
        doc.getElementById("status").getAttribute("data-l10n-id"),
        "zen-newtab-save-conflict",
        "The conflict has an actionable explanation",
      );
      Assert.ok(reload && !reload.hidden, "A reload action is available");
      if (reload) {
        reload.click();
      } else {
        // Keep the old implementation's diagnostic run from waiting forever.
        content.location.reload();
      }
    });
    await loaded;
    await pageRequest(second, "load");
    await SpecialPowers.spawn(second, [], () => {
      Assert.equal(
        content.document.querySelector("#links a")?.textContent,
        "Saved in first page",
        "Reload shows the newer saved link",
      );
    });
    Assert.ok((await edit(second, "clock")).ok, "The refreshed edit succeeds");
    const final = JSON.parse(Services.prefs.getStringPref(STATE_PREF));
    Assert.equal(final.clock, "24", "The requested clock format is saved");
    Assert.equal(
      final.links[0]?.title,
      "Saved in first page",
      "The link is retained",
    );
  } finally {
    for (const tab of tabs) {
      await BrowserTestUtils.removeTab(tab);
    }
    await SpecialPowers.popPrefEnv();
  }
});
