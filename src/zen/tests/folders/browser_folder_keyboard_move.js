/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

add_task(async function test_keyboard_mixed_folder_extraction() {
  const previousSpace = gZenWorkspaces.getActiveWorkspace();
  const workspace = await gZenWorkspaces.createAndSaveWorkspace(
    "Keyboard folder boundaries"
  );
  try {
    for (const forward of [true, false]) {
      for (const pinned of [true, false]) {
        for (const mode of ["edge", "neighbour", "nested", "collapsed"]) {
          // Root pin order only permits these two collapsed-group crossings.
          if (mode === "collapsed" && forward !== pinned) {
            continue;
          }
          const withNeighbour = mode === "neighbour" || mode === "collapsed";
          const description = `${forward ? "forward" : "backward"}, ${pinned ? "pinned" : "ordinary"} child, ${mode}`;
          info(description);
          const folders = [];
          const removed = new Set();
          const tabs = [];
          const onRemoved = event => removed.add(event.target);
          const addFolder = () => {
            const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
            tabs.push(tab);
            if (pinned) {
              gBrowser.pinTab(tab);
            }
            const folder = gZenFolders.createFolder([tab], {
              pinned: !pinned,
              renameFolder: false,
            });
            folder.collapsed = false;
            folder.addEventListener("TabGroupRemoved", onRemoved);
            folders.push(folder);
            return { tab, folder };
          };
          const { tab, folder } = addFolder();
          let moveEvents = 0;
          const onMove = event => {
            if (event.target === tab) {
              moveEvents++;
            }
          };
          tab.addEventListener("TabMove", onMove);
          try {
            let expectedOwner = null;
            if (mode === "nested") {
              expectedOwner = gZenFolders.createFolder([], {
                pinned: !pinned,
                renameFolder: false,
              });
              expectedOwner.collapsed = false;
              expectedOwner.addEventListener("TabGroupRemoved", onRemoved);
              folders.push(expectedOwner);
              gBrowser.zenHandleTabMove(folder, () => {
                expectedOwner.groupContainer.append(folder);
              });
            } else if (mode === "collapsed") {
              gBrowser.ungroupTab(tab);
            }
            let neighbour = null;
            if (withNeighbour) {
              const other = addFolder();
              neighbour = other.tab;
              other.folder.collapsed = mode === "collapsed";
              gBrowser.zenHandleTabMove(other.folder, () => {
                if (forward) {
                  folder.after(other.folder);
                } else {
                  folder.before(other.folder);
                }
              });
            }
            Assert.equal(
              gBrowser.tabContainer.findNextTab(tab, {
                direction: forward ? 1 : -1,
                filter: next => !next.hidden && next.pinned === tab.pinned,
              }),
              neighbour,
              `${description}: the intended keyboard branch is reachable`
            );
            moveEvents = 0;
            gBrowser.selectedTab = tab;
            tab.focus();
            EventUtils.synthesizeKey(
              forward ? "KEY_ArrowDown" : "KEY_ArrowUp",
              { accelKey: true, shiftKey: true }
            );
            Assert.equal(
              tab.group,
              expectedOwner,
              `${description}: child leaves its folder`
            );
            Assert.equal(
              tab.parentElement,
              expectedOwner?.groupContainer ||
                (pinned
                  ? gZenWorkspaces.activeWorkspaceElement.pinnedTabsContainer
                  : gZenWorkspaces.activeWorkspaceElement.tabsContainer),
              `${description}: extraction uses the child's correct container`
            );
            Assert.equal(
              tab.pinned,
              pinned,
              `${description}: pin flag survives`
            );
            Assert.equal(
              gBrowser.selectedTab,
              tab,
              `${description}: selection survives`
            );
            if (mode !== "collapsed") {
              Assert.greater(
                moveEvents,
                0,
                `${description}: native TabMove is emitted`
              );
            }
            Assert.equal(
              gBrowser.tabs[tab.index],
              tab,
              `${description}: native index is current`
            );
            const strip = gZenWorkspaces.activeWorkspaceStrip;
            Assert.equal(
              strip.lastElementChild.id,
              "tabbrowser-arrowscrollbox-periphery",
              `${description}: the ordinary periphery remains last`
            );
          } finally {
            tab.removeEventListener("TabMove", onMove);
            for (const item of folders) {
              if (item.isConnected && !removed.has(item)) {
                await removeFolder(item);
              }
              item.removeEventListener("TabGroupRemoved", onRemoved);
            }
            for (const item of tabs) {
              if (item.isConnected && !item.closing) {
                await BrowserTestUtils.removeTab(item);
              }
            }
          }
        }
      }
    }
  } finally {
    await gZenWorkspaces.changeWorkspace(previousSpace);
    await gZenWorkspaces.removeWorkspace(workspace.uuid);
  }
});
