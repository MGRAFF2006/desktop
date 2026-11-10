/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

add_task(async function test_tree_drop_preserves_tabs_and_selection() {
  const first = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const child = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const last = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const folder = gZenFolders.createFolder([child], { renameFolder: false });
  const nested = gZenFolders.createFolder([], { pinned: false, renameFolder: false });
  registerCleanupFunction(async () => {
    for (const group of [nested, folder]) {
      if (group.isConnected) await removeFolder(group);
    }
    for (const tab of [first, child, last]) {
      if (tab.isConnected && !tab.closing) await BrowserTestUtils.removeTab(tab);
    }
  });
  gBrowser.selectedTab = child;
  const handler = gBrowser.tabContainer.tabDragAndDrop;
  const drop = (item, target, before = false) => {
    item._dragData = { dropElement: target, dropBefore: before, movingTabs: [item] };
    try {
      return handler._handleFolderDrop({
        dataTransfer: { mozGetDataAt: () => item },
      });
    } finally {
      delete item._dragData;
    }
  };
  ok(drop(folder, first), "Native folder drop is handled as a tree");
  Assert.equal(folder.previousElementSibling, first, "Folder interleaves regular rows");
  Assert.equal(child.group, folder, "Moving the row preserves membership");
  Assert.equal(gBrowser.selectedTab, child, "Moving a folder preserves selection");
  ok(!child.pinned, "Moving the folder does not pin the tab");
  ok(gBrowser.tabs.includes(child), "Tab cache still includes nested tab");

  ok(drop(nested, folder.labelElement), "Folder can nest inside another folder");
  Assert.equal(nested.group, folder, "Nesting updates native ownership");
  ok(drop(folder, nested.labelElement), "Rejected cycle is consumed");
  Assert.equal(folder.parentElement, gZenWorkspaces.activeWorkspaceElement.tabsContainer,
    "Rejected cycle leaves the parent in its section");
  Assert.equal(nested.group, folder, "Rejected cycle leaves the child in place");

  ok(drop(child, last, true), "Tab can move out to a workspace position");
  Assert.equal(child.group, null, "Tab is no longer grouped");
  Assert.equal(child.nextElementSibling, last, "Tab lands at the requested position");
  ok(!child.pinned, "Moving out preserves pin status");
  Assert.equal(gBrowser.selectedTab, child, "Moving out preserves selection");
});
