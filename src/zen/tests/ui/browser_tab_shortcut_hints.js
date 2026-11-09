/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

function shortcutHint(tab) {
  return tab.querySelector(".zen-tab-shortcut-hint")?.value;
}

async function checkShortcutTargets() {
  await TestUtils.waitForCondition(() => {
    const tabs = gBrowser.visibleTabs;
    return (
      tabs
        .slice(0, 8)
        .every((tab, index) => shortcutHint(tab) === `${index + 1}`) &&
      (tabs.length <= 8 || shortcutHint(tabs.at(-1)) === "9")
    );
  }, "Hints follow the browser's keyboard targets");
  for (
    let index = 0;
    index < Math.min(8, gBrowser.visibleTabs.length);
    index++
  ) {
    gBrowser.selectTabAtIndex(index);
    Assert.equal(
      shortcutHint(gBrowser.selectedTab),
      `${index + 1}`,
      "The displayed shortcut selects this tab"
    );
  }
  if (gBrowser.visibleTabs.length > 8) {
    gBrowser.selectTabAtIndex(-1);
    Assert.equal(
      shortcutHint(gBrowser.selectedTab),
      "9",
      "Shortcut 9 selects the last tab"
    );
    for (const tab of gBrowser.visibleTabs.slice(8, -1)) {
      Assert.equal(
        shortcutHint(tab),
        undefined,
        "Tabs without a number shortcut have no misleading hint"
      );
    }
  }
}

add_task(async function test_hints_follow_moves_pins_and_hidden_tabs() {
  await gZenWorkspaces.promiseInitialized;
  const originalTab = gBrowser.selectedTab;
  const tabs = [];
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.show-shortcut-hints", true]],
  });
  try {
    for (let index = 0; index < 10; index++) {
      tabs.push(BrowserTestUtils.addTab(gBrowser, "about:blank"));
    }
    await checkShortcutTargets();
    const moved = tabs.at(-1);
    gBrowser.pinTab(moved);
    await checkShortcutTargets();
    gBrowser.unpinTab(moved);
    gBrowser.moveTabTo(moved, 0);
    await checkShortcutTargets();
    const hidden = tabs[3];
    gBrowser.selectedTab = originalTab;
    gBrowser.hideTab(hidden);
    await TestUtils.waitForCondition(
      () => !shortcutHint(hidden),
      "Hidden tabs lose their shortcut hint"
    );
    await checkShortcutTargets();
    gBrowser.showTab(hidden);
    await checkShortcutTargets();
    for (const tab of tabs.splice(2)) {
      BrowserTestUtils.removeTab(tab);
    }
    await checkShortcutTargets();
  } finally {
    gBrowser.selectedTab = originalTab;
    for (const tab of tabs) {
      BrowserTestUtils.removeTab(tab);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_disabling_hints_removes_their_markup() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.show-shortcut-hints", true]],
  });
  try {
    await TestUtils.waitForCondition(() =>
      document.querySelector(".zen-tab-shortcut-hint")
    );
    await SpecialPowers.pushPrefEnv({
      set: [["zen.tabs.show-shortcut-hints", false]],
    });
    try {
      Assert.equal(
        document.querySelector(".zen-tab-shortcut-hint"),
        null,
        "Disabling hints restores the ordinary tab UI"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(
  async function test_unloaded_favicon_setting_keeps_tab_text_readable() {
    const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
    const icon = tab.querySelector(".tab-icon-image");
    const label = tab.querySelector(".tab-label");
    const previousPending = icon.getAttribute("pending");
    icon.style.transition = "none";
    await SpecialPowers.pushPrefEnv({
      set: [
        ["browser.tabs.fadeOutUnloadedTabs", false],
        ["browser.tabs.fadeOutExplicitlyUnloadedTabs", true],
      ],
    });
    try {
      const textOpacity = getComputedStyle(label).opacity;
      icon.setAttribute("pending", "true");
      await TestUtils.waitForCondition(
        () => getComputedStyle(icon).opacity === "1",
        "Restored tabs remain undimmed while their option is off"
      );
      const normalOpacity = getComputedStyle(icon).opacity;
      const wasDiscarded = icon.getAttribute("discarded");
      icon.setAttribute("discarded", "true");
      Assert.equal(
        getComputedStyle(icon).opacity,
        "0.5",
        "Manual unload keeps its existing native indicator"
      );
      if (wasDiscarded === null) {
        icon.removeAttribute("discarded");
      } else {
        icon.setAttribute("discarded", wasDiscarded);
      }
      await SpecialPowers.pushPrefEnv({
        set: [["browser.tabs.fadeOutUnloadedTabs", true]],
      });
      try {
        await TestUtils.waitForCondition(
          () => getComputedStyle(icon).opacity === "0.5",
          "The native unloaded-tab setting dims only the favicon"
        );
        Assert.notEqual(normalOpacity, "0.5");
        Assert.equal(
          getComputedStyle(label).opacity,
          textOpacity,
          "Tab text keeps its original contrast"
        );
        Assert.equal(
          getComputedStyle(tab).opacity,
          "1",
          "The entire tab is not faded"
        );
      } finally {
        await SpecialPowers.popPrefEnv();
      }
    } finally {
      if (previousPending === null) {
        icon.removeAttribute("pending");
      } else {
        icon.setAttribute("pending", previousPending);
      }
      await SpecialPowers.popPrefEnv();
      BrowserTestUtils.removeTab(tab);
    }
  }
);

add_task(async function test_group_collapse_reassigns_shortcut_hints() {
  await gZenWorkspaces.promiseInitialized;
  const original = gBrowser.selectedTab;
  const tabs = Array.from({ length: 4 }, () =>
    BrowserTestUtils.addTab(gBrowser, "about:blank")
  );
  let folder;
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.show-shortcut-hints", true]],
  });
  try {
    folder = await gZenFolders.createFolder(tabs.slice(0, 2));
    gBrowser.selectedTab = original;
    await checkShortcutTargets();
    folder.collapsed = true;
    await checkShortcutTargets();
    folder.collapsed = false;
    await checkShortcutTargets();
    folder.collapsed = true;
    gBrowser.selectedTab = tabs[0];
    await checkShortcutTargets();
  } finally {
    gBrowser.selectedTab = original;
    if (folder?.isConnected) {
      const removed = BrowserTestUtils.waitForEvent(folder, "TabGroupRemoved");
      folder.delete();
      await removed;
    }
    for (const tab of tabs) {
      if (tab.isConnected) BrowserTestUtils.removeTab(tab);
    }
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_hints_follow_non_character_shortcut_remapping() {
  await gZenWorkspaces.promiseInitialized;
  const key = document.getElementById("key_selectTab1");
  const previous = new Map(
    ["key", "keycode", "modifiers"].map(attribute => [
      attribute,
      key.getAttribute(attribute),
    ])
  );
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.show-shortcut-hints", true]],
  });
  try {
    key.removeAttribute("key");
    key.setAttribute("keycode", "VK_F8");
    key.setAttribute("modifiers", "accel");
    const target = gBrowser.visibleTabs[0];
    await TestUtils.waitForCondition(
      () => shortcutHint(target) === "F8",
      "A remapped function key remains visible on its target tab"
    );
    Assert.equal(
      target
        .querySelector(".zen-tab-shortcut-hint")
        .getAttribute("tooltiptext"),
      ShortcutUtils.prettifyShortcut(key),
      "The tooltip includes the full shortcut with modifiers"
    );
    key.removeAttribute("keycode");
    key.setAttribute("key", "1");
    await TestUtils.waitForCondition(
      () => shortcutHint(target) === "1",
      "Remapping back to a character restores its hint"
    );
  } finally {
    for (const [attribute, value] of previous) {
      if (value === null) {
        key.removeAttribute(attribute);
      } else {
        key.setAttribute(attribute, value);
      }
    }
    await SpecialPowers.popPrefEnv();
  }
});
