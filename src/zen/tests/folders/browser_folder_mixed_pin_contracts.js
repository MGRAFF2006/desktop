/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

add_task(async function test_mixed_tree_native_pin_and_position_contracts() {
  const startCount = gBrowser.pinnedTabCount;
  const tabs = [];
  const add = options => {
    const tab = BrowserTestUtils.addTab(gBrowser, "about:blank", options);
    tabs.push(tab);
    return tab;
  };
  const pinnedChild = add();
  gBrowser.pinTab(pinnedChild);
  const pinnedFolder = gZenFolders.createFolder([pinnedChild], {
    renameFolder: false,
  });
  const regularChild = add();
  pinnedFolder.addTabs([regularChild]);
  const ordinaryChild = add();
  const ordinaryFolder = gZenFolders.createFolder([ordinaryChild], {
    renameFolder: false,
  });
  const laterPin = add();
  gBrowser.pinTab(laterPin);
  ordinaryFolder.addTabs([laterPin]);
  registerCleanupFunction(async () => {
    for (const folder of [pinnedFolder, ordinaryFolder]) {
      if (folder.isConnected) {
        await removeFolder(folder);
      }
    }
    for (const tab of tabs) {
      if (tab.isConnected && !tab.closing) {
        await BrowserTestUtils.removeTab(tab);
      }
    }
  });

  Assert.equal(
    gBrowser.pinnedTabCount,
    startCount + 2,
    "Pin count includes a later pinned child and excludes ordinary placeholders"
  );
  ok(
    gBrowser.zenIsInPinnedSection(regularChild),
    "Ordinary child occupies its pinned root section"
  );
  ok(
    !gBrowser.zenIsInPinnedSection(laterPin),
    "Pinned child occupies its ordinary root section"
  );
  Assert.equal(
    gBrowser.zenPinnedBoundary([
      pinnedChild,
      regularChild,
      ordinaryChild,
      laterPin,
    ]),
    2,
    "Tab-array section boundary follows root placement rather than flags"
  );
  Assert.equal(
    gBrowser.zenPinnedBoundary([
      pinnedFolder.labelElement,
      regularChild,
      ordinaryFolder.labelElement,
    ]),
    2,
    "Item-array boundary accounts for folder rows separately from tab indices"
  );

  const rootNormal = add({ tabIndex: 0 });
  Assert.equal(
    rootNormal.parentElement,
    gZenWorkspaces.activeWorkspaceElement.tabsContainer,
    "Normal indexed insertion cannot land in the pinned tree"
  );
  gBrowser.moveTabTo(rootNormal, { tabIndex: 0, forceUngrouped: true });
  Assert.equal(
    rootNormal.parentElement,
    gZenWorkspaces.activeWorkspaceElement.tabsContainer,
    "Native indexed move clamps normal root placement after the pinned section"
  );
  gBrowser.pinTab(rootNormal);
  Assert.equal(
    rootNormal.parentElement,
    gZenWorkspaces.pinnedTabsContainer,
    "Pin action reaches pinned root after an ordinary child in pinned folder"
  );
  Assert.equal(gBrowser.pinnedTabCount, startCount + 3);
  gBrowser.unpinTab(rootNormal);
  Assert.equal(
    rootNormal.parentElement,
    gZenWorkspaces.activeWorkspaceElement.tabsContainer,
    "Unpin action reaches ordinary root with mixed folder flags present"
  );
  Assert.equal(gBrowser.pinnedTabCount, startCount + 2);

  const explicitChild = add({ pinned: true, tabGroup: ordinaryFolder });
  Assert.equal(
    explicitChild.group,
    ordinaryFolder,
    "Native explicit folder insertion retains its parent despite a pinned flag"
  );
  ok(explicitChild.pinned, "Explicit insertion retains the individual flag");
  ok(
    !regularChild.pinned,
    "Ordinary child stays ordinary through native operations"
  );
  ok(laterPin.pinned, "Pinned child stays pinned through native operations");
  // Default forceUngrouped=false must not let a group/label borrow the child
  // move exemption when its target index happens to be inside another folder.
  for (const moving of [pinnedFolder, pinnedFolder.labelElement]) {
    gBrowser.moveTabTo(moving, { tabIndex: laterPin.index });
    Assert.equal(
      pinnedFolder.parentElement,
      gZenWorkspaces.pinnedTabsContainer,
      "Indexed pinned folder moves retain the pinned root section"
    );
    ok(pinnedFolder.pinned, "Indexed folder move preserves its own marker");
  }
  for (const moving of [ordinaryFolder, ordinaryFolder.labelElement]) {
    gBrowser.moveTabTo(moving, { tabIndex: regularChild.index });
    Assert.equal(
      ordinaryFolder.parentElement,
      gZenWorkspaces.activeWorkspaceElement.tabsContainer,
      "Indexed ordinary folder moves retain the ordinary root section"
    );
    ok(!ordinaryFolder.pinned, "Indexed label move preserves its own marker");
  }
});

add_task(
  async function test_OrdinaryRootFallbackMovesPreserveNativeRegistration() {
    await gZenWorkspaces.promiseInitialized;
    const strip = gZenWorkspaces.activeWorkspaceElement.tabsContainer;
    const periphery = strip.querySelector(
      "#tabbrowser-arrowscrollbox-periphery"
    );
    for (const [name, move] of [
      ["no index", tab => gBrowser.moveTabTo(tab, {})],
      [
        "past the end",
        tab => gBrowser.moveTabTo(tab, { tabIndex: gBrowser.tabs.length + 10 }),
      ],
      ["after a missing neighbour", tab => gBrowser.moveTabAfter(tab, null)],
      ["before a missing neighbour", tab => gBrowser.moveTabBefore(tab, null)],
    ]) {
      const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
      try {
        Assert.equal(
          strip.lastElementChild,
          periphery,
          `${name}: insertion starts with a valid periphery`
        );
        move(tab);
        Assert.equal(
          strip.lastElementChild,
          periphery,
          `${name}: the periphery stays last`
        );
        Assert.ok(
          gBrowser.tabs.includes(tab),
          `${name}: the tab remains registered`
        );
        Assert.equal(
          gBrowser.tabs[tab.index],
          tab,
          `${name}: the native index still identifies the tab`
        );
      } finally {
        // Preserve normal native cleanup even when an old implementation fails.
        if (tab.parentNode === strip && strip.lastElementChild !== periphery) {
          strip.insertBefore(tab, periphery);
          gBrowser.tabContainer._invalidateCachedTabs();
        }
        if (tab.isConnected && !tab.closing) {
          await BrowserTestUtils.removeTab(tab);
        }
      }
    }
  }
);

add_task(
  async function test_IndexedMovesKeepEssentialsAndWorkspacePinsSeparate() {
    const previousSpace = gZenWorkspaces.getActiveWorkspace();
    const workspace = await gZenWorkspaces.createAndSaveWorkspace(
      "Essential move boundaries"
    );
    const tabs = [];
    const folders = [];
    const removed = new Set();
    const onRemoved = event => removed.add(event.target);
    const add = () => {
      const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
      tabs.push(tab);
      return tab;
    };
    const addEssential = () => {
      const tab = add();
      gBrowser.pinTab(tab);
      gZenPinnedTabManager.addToEssentials(tab);
      return tab;
    };
    const addFolder = tab => {
      const folder = gZenFolders.createFolder([tab], {
        pinned: false,
        renameFolder: false,
      });
      folder.addEventListener("TabGroupRemoved", onRemoved);
      folders.push(folder);
      return folder;
    };
    const pins = gZenWorkspaces.activeWorkspaceElement.pinnedTabsContainer;
    const restoreRoot = (tab, section, before = null) => {
      gBrowser.zenHandleTabMove(tab, () => section.insertBefore(tab, before));
    };
    try {
      for (const essentialMoves of [true, false]) {
        const essential = addEssential();
        const pin = add();
        gBrowser.pinTab(pin);
        const essentials = gZenWorkspaces.getEssentialsSection(essential);
        try {
          gBrowser.moveTabTo(essentialMoves ? essential : pin, {
            tabIndex: essentialMoves ? pin.index : essential.index,
          });
          Assert.equal(
            essential.parentNode,
            essentials,
            "An indexed move cannot move an Essential into workspace pins"
          );
          Assert.equal(
            pin.parentNode,
            pins,
            "An indexed move cannot move a workspace pin into Essentials"
          );
          Assert.ok(
            essential.hasAttribute("zen-essential"),
            "Essential identity is preserved"
          );
          Assert.ok(
            !pin.hasAttribute("zen-essential"),
            "Workspace pin identity is preserved"
          );
        } finally {
          // Restore valid roots before cleanup when testing an old implementation.
          restoreRoot(essential, essentials);
          restoreRoot(
            pin,
            pins,
            pins.querySelector(".pinned-tabs-container-separator")
          );
          await BrowserTestUtils.removeTab(pin);
          await BrowserTestUtils.removeTab(essential);
        }
      }
      const essential = addEssential();
      const essentials = gZenWorkspaces.getEssentialsSection(essential);
      const ordinary = add();
      const ordinaryFolder = addFolder(ordinary);
      gBrowser.moveTabTo(essential, { tabIndex: ordinary.index });
      Assert.equal(
        essential.parentNode,
        essentials,
        "An Essential cannot enter an ordinary folder through an indexed move"
      );
      restoreRoot(essential, essentials);

      const pinnedChild = add();
      gBrowser.pinTab(pinnedChild);
      const mixedFolder = addFolder(pinnedChild);
      Assert.ok(
        !mixedFolder.pinned && pinnedChild.pinned,
        "Fixture contains a pinned child in ordinary rows"
      );
      gBrowser.moveTabTo(pinnedChild, { tabIndex: essential.index });
      Assert.equal(
        pinnedChild.parentNode,
        pins,
        "A mixed-folder pin aimed at Essentials moves to workspace pins"
      );
      Assert.ok(
        !pinnedChild.hasAttribute("zen-essential"),
        "Extraction does not convert the child into an Essential"
      );

      gBrowser.moveTabTo(pinnedChild, { tabIndex: ordinary.index });
      Assert.equal(
        pinnedChild.group,
        ordinaryFolder,
        "An explicit child target still permits a pinned tab in an ordinary folder"
      );
      Assert.ok(
        pinnedChild.pinned && !ordinaryFolder.pinned,
        "An explicit child move preserves both pin flag and folder placement"
      );
      Assert.equal(
        gBrowser.tabs[pinnedChild.index],
        pinnedChild,
        "The mixed child retains its native index"
      );
    } finally {
      for (const folder of folders) {
        if (folder.isConnected && !removed.has(folder)) {
          await removeFolder(folder);
        }
        folder.removeEventListener("TabGroupRemoved", onRemoved);
      }
      for (const tab of tabs) {
        if (tab.isConnected && !tab.closing) {
          await BrowserTestUtils.removeTab(tab);
        }
      }
      await gZenWorkspaces.changeWorkspace(previousSpace);
      await gZenWorkspaces.removeWorkspace(workspace.uuid);
    }
  }
);
