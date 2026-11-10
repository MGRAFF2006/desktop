/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

add_task(async function test_regular_folder_mixed_rows_and_unpack() {
  const before = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const child = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const after = BrowserTestUtils.addTab(gBrowser, "about:blank");
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
