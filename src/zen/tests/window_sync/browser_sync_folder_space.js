/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_LazyRootInsertionPreservesWorkspacePeriphery() {
  await gZenWorkspaces.promiseInitialized;
  const strip = gZenWorkspaces.activeWorkspaceElement.tabsContainer;
  const periphery = strip.lastElementChild;
  const tab = gBrowser.addTrustedTab("about:blank", {
    createLazyBrowser: true,
    inBackground: true,
    elementIndex: Infinity,
  });
  try {
    Assert.ok(tab, "A lazy root tab can be registered with SessionStore");
    Assert.equal(
      tab.parentElement,
      strip,
      "The tab uses the active workspace root"
    );
    Assert.equal(
      strip.lastElementChild,
      periphery,
      "The periphery remains last"
    );
    Assert.ok(
      gBrowser.tabs.includes(tab),
      "The tab remains in the native tab list"
    );
    Assert.equal(
      gBrowser.tabs[tab.index],
      tab,
      "The inserted tab has a native position"
    );
  } finally {
    if (tab) {
      BrowserTestUtils.removeTab(tab);
    }
  }
});

add_task(async function test_MirroredFolderKeepsItsOwnSpace() {
  await gZenWorkspaces.promiseInitialized;
  const spaceA = await gZenWorkspaces.createAndSaveWorkspace("space A");
  const spaceB = await gZenWorkspaces.createAndSaveWorkspace("space B");

  try {
    await withNewSyncedWindow(async win => {
      await gZenWorkspaces.changeWorkspace(spaceB);
      await win.gZenWorkspaces.changeWorkspace(spaceA);
      Assert.equal(
        win.gZenWorkspaces.activeWorkspace,
        spaceA.uuid,
        "The other window shows a different space"
      );

      const tab = BrowserTestUtils.addTab(gBrowser, "data:text/html,folder");
      const folder = await gZenFolders.createFolder([tab], {
        renameFolder: false,
        label: "mirrored",
      });
      Assert.equal(
        folder.getAttribute("zen-workspace-id"),
        spaceB.uuid,
        "The folder is created in the space its window shows"
      );

      await TestUtils.waitForCondition(
        () => gZenWindowSync.getItemFromWindow(win, folder.id),
        "the folder is mirrored into the other window"
      );
      const mirror = gZenWindowSync.getItemFromWindow(win, folder.id);

      Assert.equal(
        mirror.getAttribute("zen-workspace-id"),
        spaceB.uuid,
        "The copy keeps the space the folder was created in"
      );
      Assert.notEqual(
        mirror.getAttribute("zen-workspace-id"),
        win.gZenWorkspaces.activeWorkspace,
        "and not the space the mirroring window happened to show"
      );

      const stored = win.gZenFolders
        .storeDataForSessionStore()
        .find(f => f.id === folder.id);
      Assert.equal(
        stored?.workspaceId,
        spaceB.uuid,
        "The other window would store the right space for it"
      );

      await folder.delete();
    });
  } finally {
    await gZenWorkspaces.removeWorkspace(spaceA.uuid);
    await gZenWorkspaces.removeWorkspace(spaceB.uuid);
  }
});

add_task(async function test_MirroredFolderKeepsTheLiveFlag() {
  await gZenWorkspaces.promiseInitialized;

  await withNewSyncedWindow(async win => {
    const folder = await gZenFolders.createFolder([], {
      renameFolder: false,
      label: "live",
      isLiveFolder: true,
    });
    Assert.ok(folder.isLiveFolder, "The folder is a live folder");

    await TestUtils.waitForCondition(
      () => gZenWindowSync.getItemFromWindow(win, folder.id),
      "the live folder is mirrored into the other window"
    );
    const mirror = gZenWindowSync.getItemFromWindow(win, folder.id);
    Assert.ok(mirror.isLiveFolder, "The copy is a live folder too");

    await folder.delete();
  });
});

add_task(
  async function test_PinnedOnlyNewWindowRetainsOrdinaryFolderStructure() {
    await SpecialPowers.pushPrefEnv({
      set: [["zen.window-sync.sync-only-pinned-tabs", true]],
    });
    const { SessionSaver } = ChromeUtils.importESModule(
      "moz-src:///browser/components/sessionstore/SessionSaver.sys.mjs"
    );
    let parent;
    try {
      await gZenWorkspaces.promiseInitialized;
      const tab = gBrowser.addTrustedTab(
        "https://example.com/?window-local-folder",
        {
          inBackground: true,
        }
      );
      parent = gZenFolders.createFolder([], {
        label: "ordinary parent",
        pinned: false,
        renameFolder: false,
      });
      const child = gZenFolders.createFolder([tab], {
        label: "ordinary child",
        pinned: false,
        renameFolder: false,
      });
      parent.addTabs([child]);
      await gBrowser.TabStateFlusher.flush(tab.linkedBrowser);
      await SessionSaver.run();
      await withNewSyncedWindow(async win => {
        await TestUtils.waitForCondition(
          () =>
            win.document.getElementById(parent.id)?.isZenFolder &&
            win.document.getElementById(child.id)?.isZenFolder,
          "ordinary folder anchors and group states survive new-window restore"
        );
        const restoredParent = win.document.getElementById(parent.id);
        const restoredChild = win.document.getElementById(child.id);
        Assert.equal(
          restoredChild.group,
          restoredParent,
          "nested ordinary folders retain their parent despite pinned-only content sync"
        );
        Assert.ok(
          !restoredParent.pinned && !restoredChild.pinned,
          "structural restoration does not pin the folders"
        );
        Assert.ok(
          !win.document.getElementById(tab.id),
          "the original window's ordinary tab content stays excluded"
        );
      });
    } finally {
      if (parent?.isConnected) {
        await parent.delete();
      }
      await SpecialPowers.popPrefEnv();
    }
  }
);

add_task(async function test_MirroredRootMovePreservesEmptyOrdinaryPeriphery() {
  await gZenWorkspaces.promiseInitialized;
  const previousSpace = gZenWorkspaces.getActiveWorkspace();
  let space;
  let folder;
  try {
    await withNewSyncedWindow(async win => {
      // A workspace created after the peer opens has never needed that
      // peer's empty-tab placeholder, so the destination contains only markers.
      space = await gZenWorkspaces.createAndSaveWorkspace(
        "Root move periphery"
      );
      await win.gZenWorkspaces.changeWorkspace(previousSpace);
      const tab = gBrowser.addTrustedTab("about:blank", { inBackground: true });
      folder = gZenFolders.createFolder([tab], {
        pinned: true,
        renameFolder: false,
      });
      await TestUtils.waitForCondition(
        () =>
          win.document
            .getElementById(folder.id)
            ?.tabs.some(child => child.id === tab.id),
        "The populated pinned folder is mirrored"
      );
      const mirror = win.document.getElementById(folder.id);
      const strip = win.gZenWorkspaces.workspaceElement(
        space.uuid
      ).tabsContainer;
      const periphery = strip.querySelector(
        "#tabbrowser-arrowscrollbox-periphery"
      );
      // Hold the mirror in its old parent until the explicit production move
      // handler runs; mutation events must not pre-position it for this test.
      await SpecialPowers.pushPrefEnv({
        set: [["zen.window-sync.enabled", false]],
      });
      try {
        Assert.ok(
          !Array.from(strip.children).some(
            child => win.gBrowser.isTab(child) || win.gBrowser.isTabGroup(child)
          ),
          "The destination has no row or placeholder to serve as an insertion anchor"
        );
        folder.pinned = false;
        gBrowser.zenHandleTabMove(folder, () =>
          gZenFolders.placeAtWorkspaceRoot(folder, space.uuid)
        );
        await gZenWindowSync.on_TabMove({ target: folder });
        Assert.equal(
          mirror.parentNode,
          strip,
          "The mirror moves into inactive ordinary rows"
        );
        Assert.equal(
          strip.lastElementChild,
          periphery,
          "The periphery stays last without a shared preceding row"
        );
        await win.gZenWorkspaces.changeWorkspace(space);
        for (const child of mirror.tabs) {
          Assert.ok(
            win.gBrowser.tabs.includes(child),
            "The mirrored descendant is in native enumeration"
          );
          Assert.equal(
            win.gBrowser.tabs[child.index],
            child,
            "The mirrored descendant has a native index"
          );
        }
      } finally {
        if (
          mirror.parentNode === strip &&
          strip.lastElementChild !== periphery
        ) {
          strip.insertBefore(mirror, periphery);
          win.gBrowser.tabContainer._invalidateCachedTabs();
        }
        await folder.delete();
        await SpecialPowers.popPrefEnv();
      }
    });
  } finally {
    await gZenWorkspaces.changeWorkspace(previousSpace);
    if (space) {
      await gZenWorkspaces.removeWorkspace(space.uuid);
    }
  }
});

add_task(async function test_AdoptingExistingOrdinaryCounterpartWithoutIndex() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.window-sync.sync-only-pinned-tabs", false]],
  });
  let sourceTab;
  try {
    await withNewSyncedWindow(async win => {
      sourceTab = gBrowser.addTrustedTab("about:blank", { inBackground: true });
      await TestUtils.waitForCondition(
        () => win.document.getElementById(sourceTab.id),
        "An ordinary counterpart is present before adoption"
      );
      const counterpart = win.document.getElementById(sourceTab.id);
      const strip = win.gZenWorkspaces.activeWorkspaceElement.tabsContainer;
      const periphery = strip.querySelector(
        "#tabbrowser-arrowscrollbox-periphery"
      );
      try {
        Assert.ok(
          gZenWorkspaces.currentWindowIsSyncing &&
            win.gZenWorkspaces.currentWindowIsSyncing,
          "Adoption exercises the existing-counterpart path"
        );
        const adopted = win.gBrowser.adoptTab(sourceTab, { selectTab: true });
        Assert.equal(
          adopted,
          counterpart,
          "Adoption reuses the existing ordinary counterpart"
        );
        Assert.equal(
          strip.lastElementChild,
          periphery,
          "Adoption keeps the periphery last"
        );
        Assert.ok(
          win.gBrowser.tabs.includes(counterpart),
          "The adopted counterpart remains registered"
        );
        Assert.equal(
          win.gBrowser.tabs[counterpart.index],
          counterpart,
          "The adopted counterpart keeps a valid native index"
        );
      } finally {
        if (
          counterpart.parentNode === strip &&
          strip.lastElementChild !== periphery
        ) {
          strip.insertBefore(counterpart, periphery);
          win.gBrowser.tabContainer._invalidateCachedTabs();
        }
      }
    });
  } finally {
    if (sourceTab?.isConnected && !sourceTab.closing) {
      await BrowserTestUtils.removeTab(sourceTab);
    }
    await SpecialPowers.popPrefEnv();
  }
});
