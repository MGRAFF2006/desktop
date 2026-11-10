/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_NormalFolderTreeAndEmptySiblingOrder() {
  await gZenWorkspaces.promiseInitialized;
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const uuid = gZenWorkspaces.activeWorkspace;
  const ids = [
    "test-normal-folder-root",
    "test-normal-folder-empty",
    "test-normal-folder-child",
    "test-normal-folder-tab",
    "test-normal-folder-before",
    "test-normal-folder-after",
  ];
  const [rootId, emptyId, childId, tabId, beforeId, afterId] = ids;
  try {
    const space = (await collectProjections()).get(uuid).data;
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        folderRecord(rootId, { pinned: false, children: [emptyId, childId] }),
        folderRecord(emptyId, { pinned: false, parentFolderId: rootId }),
        folderRecord(childId, {
          pinned: false,
          parentFolderId: rootId,
          children: [tabId],
        }),
        tabRecord(tabId, { pinned: false, folderId: childId }),
        tabRecord(beforeId, { pinned: false }),
        tabRecord(afterId, { pinned: false }),
        {
          id: uuid,
          cleartext: {
            kind: "space",
            data: { ...space, children: [beforeId, rootId, afterId] },
          },
        },
      ]),
      [],
      "ordinary folder hierarchy applies"
    );
    const root = document.getElementById(rootId);
    const child = document.getElementById(childId);
    Assert.equal(child.group, root, "nested folder stays nested");
    Assert.equal(
      document.getElementById(tabId).group,
      child,
      "ordinary tab stays in child"
    );
    Assert.ok(
      !document.getElementById(tabId).pinned,
      "grouping does not silently pin"
    );
    Assert.equal(
      root.parentNode,
      gZenWorkspaces.workspaceElement(uuid).tabsContainer,
      "ordinary folder belongs to regular tab rows"
    );
    const projection = await collectProjections();
    Assert.equal(
      projection.get(rootId).data.pinned,
      false,
      "folder pin state round trips"
    );
    Assert.deepEqual(
      projection.get(rootId).data.children,
      [emptyId, childId],
      "an empty folder keeps its position ahead of a nonempty sibling"
    );
    Assert.deepEqual(
      projection
        .get(uuid)
        .data.children.filter(id => [beforeId, rootId, afterId].includes(id)),
      [beforeId, rootId, afterId],
      "folder and ordinary tabs remain interleaved"
    );
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        tabRecord(tabId, { pinned: false, folderId: null }),
        tombstone(rootId),
      ]),
      [],
      "move and folder close apply in one batch"
    );
    Assert.ok(
      document.getElementById(tabId),
      "moved-out tab survives folder close"
    );
    Assert.ok(
      !document.getElementById(tabId).group?.isZenFolder,
      "moved-out tab is top level"
    );
  } finally {
    await ZenSpacesSyncApplier.applyBatch(ids.map(tombstone));
    for (const id of ids) {
      ZenSpacesSyncModel.noteApplied(id, null);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_FolderCloseDoesNotCloseOptedOutOrdinaryTabs() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const folderId = "test-folder-optout-parent";
  const tabId = "test-folder-optout-tab";
  try {
    await ZenSpacesSyncApplier.applyBatch([
      folderRecord(folderId, { pinned: false }),
      tabRecord(tabId, { pinned: false, folderId }),
    ]);
    await collectProjections();
    ZenSpacesSyncModel.markUploaded([folderId, tabId]);
    await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, false]] });
    try {
      Assert.deepEqual(
        await ZenSpacesSyncApplier.applyBatch([tombstone(folderId)]),
        [],
        "folder tombstone applies without an indirect ordinary-tab close"
      );
      const survivor = document.getElementById(tabId);
      Assert.ok(survivor, "the opted-out tab survives");
      Assert.ok(!survivor.pinned, "the survivor remains ordinary");
      Assert.ok(
        !survivor.group?.isZenFolder,
        "the survivor is safely unpacked"
      );
      await collectProjections();
      Assert.ok(
        !(tabId in ZenSpacesSyncModel.computeChangedIDs()),
        "rescuing the local tab never uploads an ordinary-tab change while opted out"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
  } finally {
    await ZenSpacesSyncApplier.applyBatch([
      tombstone(tabId),
      tombstone(folderId),
    ]);
    ZenSpacesSyncModel.noteApplied(tabId, null);
    ZenSpacesSyncModel.noteApplied(folderId, null);
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_FolderClosePreservesOptedOutSplitDescendants() {
  await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, true]] });
  const folderId = "test-folder-optout-split-parent";
  const tabIds = ["test-folder-optout-split-a", "test-folder-optout-split-b"];
  try {
    await ZenSpacesSyncApplier.applyBatch([
      folderRecord(folderId, { pinned: false }),
      ...tabIds.map(id => tabRecord(id, { pinned: false, folderId })),
    ]);
    const tabs = tabIds.map(id => document.getElementById(id));
    const split = gZenViewSplitter.splitTabs(tabs);
    document.getElementById(folderId).appendChild(split);
    await collectProjections();
    await SpecialPowers.pushPrefEnv({ set: [[NORMAL_TABS_PREF, false]] });
    try {
      Assert.deepEqual(
        await ZenSpacesSyncApplier.applyBatch([tombstone(folderId)]),
        []
      );
      for (const tab of tabs) {
        Assert.ok(
          tab.isConnected && !tab.closing,
          "opted-out split child survives remote folder close"
        );
        Assert.ok(!tab.pinned, "split child retains ordinary pin state");
      }
      Assert.ok(
        !split.group?.isZenFolder,
        "the entire split leaves the deleted folder"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
  } finally {
    await ZenSpacesSyncApplier.applyBatch([...tabIds, folderId].map(tombstone));
    for (const id of [...tabIds, folderId]) {
      ZenSpacesSyncModel.noteApplied(id, null);
    }
    await SpecialPowers.popPrefEnv();
  }
});
