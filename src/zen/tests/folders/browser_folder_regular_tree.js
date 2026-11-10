/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

add_task(async function test_regular_folder_mixed_rows_and_unpack() {
  const before = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const child = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const after = BrowserTestUtils.addTab(gBrowser, "about:blank");
  // New tabs may open next to the selected tab. Establish the fixture's
  // intended row order explicitly before testing grouping at that position.
  for (const tab of [before, child, after]) {
    gBrowser.moveTabTo(tab, {
      tabIndex: gBrowser.tabs.length - 1,
      forceUngrouped: true,
    });
  }
  const folder = gZenFolders.createFolder([child], {
    insertBefore: child,
    renameFolder: false,
  });
  registerCleanupFunction(async () => {
    for (const tab of [before, child, after]) {
      if (tab.isConnected && !tab.closing) {
        await BrowserTestUtils.removeTab(tab);
      }
    }
  });
  Assert.equal(
    folder.previousElementSibling,
    before,
    "Folder follows an ordinary row"
  );
  Assert.equal(
    folder.nextElementSibling,
    after,
    "Folder precedes an ordinary row"
  );
  ok(!child.pinned, "Grouping leaves the regular tab unpinned");

  const nested = gZenFolders.createFolder([], {
    insertAfter: child,
    pinned: false,
    renameFolder: false,
  });
  Assert.equal(
    nested.group,
    folder,
    "Empty folders can nest among regular child rows"
  );
  ok(
    !gZenFolders.canDropElement(folder, nested.labelElement),
    "Cannot move a parent inside itself"
  );

  const state = gZenFolders.storeDataForSessionStore();
  const rootState = state.find(entry => entry.id === folder.id);
  const nestedState = state.find(entry => entry.id === nested.id);
  Assert.equal(
    rootState.pinned,
    false,
    "Session metadata preserves ordinary folder placement"
  );
  Assert.equal(
    rootState.prevSiblingInfo.id,
    before.id,
    "Session metadata preserves tab/folder order"
  );
  Assert.equal(
    nestedState.parentId,
    folder.id,
    "Session metadata preserves nesting"
  );

  await folder.unpackTabs();
  ok(child.isConnected && !child.closing, "Unpack keeps the real tab alive");
  ok(nested.isConnected, "Unpack keeps the child folder alive");
  Assert.equal(
    nested.parentElement,
    gZenWorkspaces.activeWorkspaceElement.tabsContainer
  );
  ok(!child.pinned, "Unpacking preserves pin state");
  await removeFolder(nested);
});

add_task(async function test_existing_pinned_folder_remains_supported() {
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.pinTab(tab);
  const folder = gZenFolders.createFolder([tab], { renameFolder: false });
  ok(
    folder.pinned,
    "A folder created from pinned tabs uses the pinned section"
  );
  ok(tab.pinned, "Pinned input stays pinned");
  Assert.equal(
    folder.parentElement,
    gZenWorkspaces.activeWorkspaceElement.pinnedTabsContainer
  );
  await removeFolder(folder);
});

add_task(
  async function test_homepage_tabs_use_individual_flags_across_folder_sections() {
    const { HomePage } = ChromeUtils.importESModule(
      "resource:///modules/HomePage.sys.mjs"
    );
    const normal = BrowserTestUtils.addTab(
      gBrowser,
      "https://example.com/ordinary"
    );
    const pin = BrowserTestUtils.addTab(gBrowser, "https://example.com/pinned");
    gBrowser.pinTab(pin);
    const legacy = gZenFolders.createFolder([], {
      pinned: true,
      renameFolder: false,
    });
    const ordinary = gZenFolders.createFolder([], {
      pinned: false,
      renameFolder: false,
    });
    try {
      legacy.addTabs([normal]);
      ordinary.addTabs([pin]);
      const homepageTabs = HomePage.getTabsForCustomHomepage(window);
      Assert.ok(
        homepageTabs.includes(normal),
        "ordinary child in pinned root remains eligible"
      );
      Assert.ok(
        !homepageTabs.includes(pin),
        "pinned child in ordinary root remains excluded"
      );
      Assert.ok(
        !homepageTabs.some(tab => tab.hasAttribute("zen-empty-tab")),
        "synthetic folder anchors are never homepages"
      );
    } finally {
      await removeFolder(legacy);
      await removeFolder(ordinary);
    }
  }
);

add_task(
  async function test_last_window_warning_counts_visible_ordinary_tabs() {
    const sandbox = Cu.Sandbox(
      Services.scriptSecurityManager.getSystemPrincipal(),
      {
        wantXrays: false,
      }
    );
    try {
      const tab = attributes => ({
        pinned: attributes.includes("pinned"),
        hasAttribute: name => attributes.includes(name),
      });
      let triggerQueries = 0;
      sandbox.window = {};
      sandbox.document = { documentElement: { hasAttribute: () => false } };
      sandbox.browserWindows = () => [sandbox.window];
      sandbox.closeWindow = () => true;
      sandbox.CanCloseWindow = () => true;
      sandbox.warnAboutClosingWindow = () => true;
      sandbox.AppConstants = { platform: "linux" };
      sandbox.Services = { prefs: { getBoolPref: () => true } };
      sandbox.gLastWindowCloseTriggerHandled = false;
      sandbox.ChromeUtils = {
        importESModule: () => ({
          Spotlight: { close() {} },
          TaskbarTabsUtils: { isTaskbarTabWindow: () => false },
          ASRouter: {
            initialized: true,
            hasMessageForTrigger: () => {
              triggerQueries++;
              return false;
            },
          },
        }),
      };
      sandbox.gBrowser = {
        visibleTabs: [tab([]), tab([])],
        pinnedTabCount: 40,
        openTabs: [],
      };
      Cu.evalInSandbox(`(${WindowIsClosing.toString()})(null)`, sandbox);
      Assert.equal(
        triggerQueries,
        0,
        "hidden pins cannot suppress the warning branch for two visible ordinary tabs"
      );
      sandbox.gBrowser.visibleTabs = [
        tab([]),
        tab(["zen-empty-tab"]),
        tab(["zen-glance-tab"]),
        tab(["pinned"]),
      ];
      Cu.evalInSandbox(`(${WindowIsClosing.toString()})(null)`, sandbox);
      Assert.equal(
        triggerQueries,
        1,
        "synthetic/glance/pinned rows do not count as a second ordinary tab"
      );
    } finally {
      Cu.nukeSandbox(sandbox);
    }
  }
);

add_task(
  async function test_explicit_pinned_child_insert_keeps_ordinary_folder_parent() {
    const folder = gZenFolders.createFolder([], {
      pinned: false,
      renameFolder: false,
    });
    try {
      const tab = BrowserTestUtils.addTab(gBrowser, "about:blank", {
        pinned: true,
        tabGroup: folder,
      });
      Assert.equal(
        tab.group,
        folder,
        "workspace insertion hook preserves explicit folder placement"
      );
      Assert.ok(tab.pinned, "explicit pinned child retains its own flag");
      Assert.ok(!folder.pinned, "child does not repin the root folder");
    } finally {
      await removeFolder(folder);
    }
  }
);

add_task(
  async function test_mixed_unpack_and_native_ungroup_preserve_root_sections() {
    const normal = BrowserTestUtils.addTab(gBrowser, "about:blank");
    const pin = BrowserTestUtils.addTab(gBrowser, "about:blank");
    gBrowser.pinTab(pin);
    const legacy = gZenFolders.createFolder([], {
      pinned: true,
      renameFolder: false,
    });
    const ordinary = gZenFolders.createFolder([], {
      pinned: false,
      renameFolder: false,
    });
    try {
      legacy.addTabs([normal]);
      ordinary.addTabs([pin]);
      gBrowser.ungroupTab(normal);
      Assert.equal(
        normal.parentElement,
        gZenWorkspaces.activeWorkspaceElement.tabsContainer,
        "native ungroup rescues ordinary children to ordinary roots"
      );
      legacy.addTabs([normal]);
      await legacy.unpackTabs();
      await ordinary.unpackTabs();
      Assert.equal(
        normal.parentElement,
        gZenWorkspaces.activeWorkspaceElement.tabsContainer,
        "unpack keeps ordinary roots in ordinary section"
      );
      Assert.equal(
        pin.parentElement,
        gZenWorkspaces.activeWorkspaceElement.pinnedTabsContainer,
        "unpack returns pinned children to pins"
      );
      Assert.ok(
        !normal.pinned && pin.pinned,
        "root routing never repins children"
      );
    } finally {
      for (const tab of [normal, pin]) {
        if (tab.isConnected && !tab.closing)
          await BrowserTestUtils.removeTab(tab);
      }
      if (legacy.isConnected) await removeFolder(legacy);
      if (ordinary.isConnected) await removeFolder(ordinary);
    }
  }
);
