/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(
  async function test_Split_Group_Notifications_Have_Initialized_Markup() {
    const tabs = [
      BrowserTestUtils.addTab(gBrowser, "about:blank"),
      BrowserTestUtils.addTab(gBrowser, "about:blank"),
    ];
    const parent = gZenFolders.createFolder(tabs, { renameFolder: false });
    const destination = gZenFolders.createFolder([], { renameFolder: false });
    const notifications = [];
    const onNotification = event => {
      notifications.push({
        type: event.type,
        parent: event.target,
        child: event.detail,
        initialized: !!(
          event.detail.labelElement && event.detail.groupContainer
        ),
        connected: event.detail.isConnected,
      });
    };
    for (const folder of [parent, destination]) {
      folder.addEventListener("FolderGrouped", onNotification);
      folder.addEventListener("FolderUngrouped", onNotification);
    }
    registerCleanupFunction(() => {
      for (const folder of [parent, destination]) {
        folder.removeEventListener("FolderGrouped", onNotification);
        folder.removeEventListener("FolderUngrouped", onNotification);
      }
      gZenViewSplitter.removeTabFromGroup(tabs[0]);
      for (const folder of [parent, destination]) {
        for (const tab of [...folder.tabs]) {
          BrowserTestUtils.removeTab(tab);
        }
        folder.remove();
      }
    });

    parent.collapsed = true;
    Assert.ok(parent.collapsed, "The inactive pinned parent starts collapsed");
    const splitData = gZenViewSplitter.splitTabs(tabs, "grid", 0, {
      activate: false,
    });
    const split = document.getElementById(splitData.groupId);
    Assert.equal(
      split.group,
      parent,
      "The native split group nests in the folder"
    );
    Assert.equal(
      notifications.length,
      1,
      "Grouping notifies synchronously once"
    );
    Assert.equal(
      notifications[0].parent,
      parent,
      "The parent receives grouping"
    );
    Assert.equal(
      notifications[0].child,
      split,
      "The notification identifies the split"
    );
    Assert.ok(
      notifications[0].initialized,
      "Grouping exposes initialized label and container"
    );
    Assert.ok(
      notifications[0].connected,
      "Grouping observes the connected child"
    );
    Assert.ok(
      !parent.collapsed,
      "Grouping expands the inactive collapsed parent"
    );

    parent.appendChild(split);
    Assert.equal(
      notifications.length,
      1,
      "Reconnecting in the same parent does not regroup"
    );
    destination.appendChild(split);
    Assert.equal(
      notifications.length,
      3,
      "Moving parents emits exactly two notifications"
    );
    Assert.equal(
      notifications[1].type,
      "FolderUngrouped",
      "The old parent is notified first"
    );
    Assert.equal(
      notifications[1].parent,
      parent,
      "Ungrouping targets the old parent"
    );
    Assert.equal(
      notifications[2].type,
      "FolderGrouped",
      "The new parent is notified second"
    );
    Assert.equal(
      notifications[2].parent,
      destination,
      "Grouping targets the new parent"
    );
    Assert.ok(
      notifications[2].initialized,
      "Reconnecting retains initialized markup"
    );
    Assert.equal(
      split.group,
      destination,
      "The split belongs to the destination"
    );

    destination.before(split);
    Assert.equal(notifications.length, 4, "Moving to the root only ungroups");
    Assert.equal(
      notifications[3].type,
      "FolderUngrouped",
      "Root extraction notifies ungrouping"
    );
    destination.appendChild(split);
    Assert.equal(
      notifications.length,
      5,
      "Rejoining the former parent groups again"
    );
    Assert.equal(
      notifications[4].type,
      "FolderGrouped",
      "Root extraction clears remembered membership"
    );
  }
);
