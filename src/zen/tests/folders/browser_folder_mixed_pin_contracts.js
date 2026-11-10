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
      if (folder.isConnected) await removeFolder(folder);
    }
    for (const tab of tabs) {
      if (tab.isConnected && !tab.closing)
        await BrowserTestUtils.removeTab(tab);
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
