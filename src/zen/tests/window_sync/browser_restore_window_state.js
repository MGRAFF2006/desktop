/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Exercise SessionStore itself: cleanup, native tab/group reconstruction,
// folder reconstruction and the asynchronous WindowSync event queue.
add_task(
  async function test_replacing_window_state_preserves_folders_and_peers() {
    const tabSnapshot = node =>
      node.tabs.map(t => {
        const raw = SessionStore.getTabState(t);
        const state = typeof raw === "string" ? JSON.parse(raw) : raw;
        return {
          id: t.id,
          pinned: t.pinned,
          entries: state.entries.map(e => e.url),
        };
      });
    for (const pinnedOnly of [true, false]) {
      await SpecialPowers.pushPrefEnv({
        set: [["zen.window-sync.sync-only-pinned-tabs", pinnedOnly]],
      });
      for (const selection of ["nested", "parent", "inactive"]) {
        const switched = selection === "inactive";
        await SpecialPowers.pushPrefEnv({
          set: [["zen.window-sync.enabled", false]],
        });
        let setupSyncDisabled = true;
        const source = await BrowserTestUtils.openNewBrowserWindow();
        await source.gZenStartup.promiseInitialized;
        let peer;
        let workspace;
        const folderIds = [];
        try {
          const tab = source.gBrowser.addTrustedTab("https://example.com/", {
            skipAnimation: true,
          });
          const folder = source.gZenFolders.createFolder([tab], {
            label: "Restore parent",
            renameFolder: false,
          });
          Assert.ok(folder, "Parent folder creation succeeded");
          folderIds.push(folder.id);
          const nestedTab = source.gBrowser.addTrustedTab(
            "https://example.org/",
            { skipAnimation: true }
          );
          const nested = source.gZenFolders.createFolder([nestedTab], {
            label: "Restore child",
            renameFolder: false,
            insertAfter: folder.groupContainer.lastElementChild,
          });
          Assert.ok(nested, "Nested folder creation succeeded");
          folderIds.push(nested.id);
          const control = source.gZenFolders.createFolder([], {
            label: "Empty control",
            renameFolder: false,
          });
          Assert.ok(control, "Control folder creation succeeded");
          folderIds.push(control.id);
          for (const id of folderIds) {
            for (const item of source.document.getElementById(id).tabs) {
              if (!item.id) item.id = Services.uuid.generateUUID().toString();
            }
          }
          await Promise.all(
            source.gZenWorkspaces.allStoredTabs.map(t =>
              source.gBrowser.TabStateFlusher.flush(t.linkedBrowser)
            )
          );
          peer = await BrowserTestUtils.openNewBrowserWindow();
          await peer.gZenStartup.promiseInitialized;
          const peerReady = BrowserTestUtils.waitForEvent(
            peer,
            "SSWindowStateReady"
          );
          SessionStore.setWindowState(
            peer,
            SessionStore.getWindowState(source),
            true
          );
          await peerReady;
          await new Promise(resolve => source.setTimeout(resolve, 1000));
          await SpecialPowers.popPrefEnv();
          setupSyncDisabled = false;
          const expected = folderIds.map(id => {
            const node = source.document.getElementById(id);
            return {
              id,
              parent: node.group?.id,
              pinned: node.pinned,
              tabs: tabSnapshot(node),
            };
          });
          const peerTabs = folderIds.map(id =>
            tabSnapshot(peer.document.getElementById(id))
          );
          const peerNodes = folderIds.map(id =>
            peer.document.getElementById(id)
          );
          if (switched) {
            workspace = await source.gZenWorkspaces.createAndSaveWorkspace(
              "Restore inactive workspace"
            );
            Assert.ok(
              !source.gBrowser.tabs.includes(tab),
              "Fixture is inactive"
            );
          } else {
            // Reuse a browser from both direct and nested old folder contents.
            source.gBrowser.selectedTab =
              selection === "nested" ? nestedTab : tab;
          }
          await Promise.all(
            source.gZenWorkspaces.allStoredTabs.map(t =>
              source.gBrowser.TabStateFlusher.flush(t.linkedBrowser)
            )
          );
          const state = SessionStore.getWindowState(source);
          const closedInPeer = [];
          const onClose = event => closedInPeer.push(event.target.id);
          peer.addEventListener("TabClose", onClose, true);
          try {
            const ready = BrowserTestUtils.waitForEvent(
              source,
              "SSWindowStateReady"
            );
            SessionStore.setWindowState(source, state, true);
            await ready;
            // Cross the event queue, mutation-observer and group-animation turns.
            await new Promise(resolve => source.setTimeout(resolve, 1000));
            for (const item of expected) {
              const nodes = source.document.querySelectorAll(
                `[id="${item.id}"]`
              );
              Assert.equal(
                nodes.length,
                1,
                `Exactly one restored folder per ID (${selection}, pinned-only ${pinnedOnly})`
              );
              const node = nodes[0];
              Assert.equal(
                node.pinned,
                item.pinned,
                "Folder pin state survives"
              );
              Assert.equal(
                node.group?.id,
                item.parent,
                "Folder nesting survives"
              );
              Assert.deepEqual(
                tabSnapshot(node),
                item.tabs,
                "All tab identities, pin flags and history URLs survive"
              );
            }
            Assert.deepEqual(
              closedInPeer,
              [],
              "Replacement closes no peer tabs"
            );
            for (let i = 0; i < folderIds.length; i++) {
              Assert.equal(
                peer.document.getElementById(folderIds[i]),
                peerNodes[i],
                "Peer keeps its actual folder objects"
              );
              Assert.deepEqual(
                tabSnapshot(peerNodes[i]),
                peerTabs[i],
                "Peer retains its tab contents"
              );
            }
          } finally {
            peer.removeEventListener("TabClose", onClose, true);
          }
          // Append must retain existing folders and tabs; use a distinct tab ID.
          const appendedId = Services.uuid.generateUUID().toString();
          const ready = BrowserTestUtils.waitForEvent(
            source,
            "SSWindowStateReady"
          );
          SessionStore.setWindowState(
            source,
            {
              windows: [
                {
                  tabs: [
                    {
                      entries: [{ url: "https://example.net/" }],
                      zenSyncId: appendedId,
                    },
                  ],
                },
              ],
            },
            false
          );
          await ready;
          Assert.ok(
            source.document.getElementById(folder.id),
            "Append keeps folder"
          );
          Assert.ok(
            source.document.getElementById(tab.id),
            "Append keeps original tab"
          );
          Assert.ok(
            source.document.getElementById(appendedId),
            "Append adds its tab"
          );
          // A genuine close after replacement must still reach the peer.
          source.gBrowser.removeTab(source.document.getElementById(tab.id));
          await TestUtils.waitForCondition(
            () => !peer.document.getElementById(tab.id),
            "Real user close still synchronizes after replacement"
          );
        } finally {
          if (setupSyncDisabled) await SpecialPowers.popPrefEnv();
          // Remove only this test's fixtures, including their synced copies.
          for (const id of folderIds) {
            const folder = source.document.getElementById(id);
            if (folder?.isConnected) {
              await folder.delete();
            }
          }
          if (peer && !peer.closed) {
            await BrowserTestUtils.closeWindow(peer);
          }
          await BrowserTestUtils.closeWindow(source);
          if (workspace) {
            await gZenWorkspaces.removeWorkspace(workspace.uuid);
          }
        }
      }
      await SpecialPowers.popPrefEnv();
    }
  }
);
