/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

function gradientTheme(algorithm, lightness) {
  return {
    type: "gradient",
    gradientColors: [
      {
        c: [120, 40, 200],
        isCustom: false,
        algorithm,
        isPrimary: true,
        lightness,
        position: { x: 10, y: 10 },
        type: "primary",
      },
    ],
    opacity: 0.5,
    texture: 0,
  };
}

add_task(async function test_RenderingAnotherSpaceKeepsTheAlgorithm() {
  await gZenWorkspaces.promiseInitialized;
  const picker = gZenThemePicker;
  const other = {
    uuid: "test-theme-algorithm-other",
    theme: gradientTheme("complementary", 40),
  };

  picker.useAlgo = "analogous";
  picker.invalidateGradientCache(other.uuid);
  const rendered = picker.getGradientForWorkspace(other);

  Assert.ok(rendered.gradient, "The other space's gradient should be built");
  Assert.equal(
    picker.useAlgo,
    "analogous",
    "Rendering another space should leave the edited algorithm alone"
  );

  picker.invalidateGradientCache(other.uuid);
});

add_task(async function test_SchemeChangeRefreshesInactiveWorkspaceThemes() {
  await gZenWorkspaces.promiseInitialized;
  const picker = gZenThemePicker;
  const inactive = {
    uuid: "test-theme-inactive-scheme",
    theme: { gradientColors: [], opacity: 0.5 },
  };
  await SpecialPowers.pushPrefEnv({
    set: [["zen.view.window.scheme", 1]],
  });
  try {
    const light = picker.getGradientForWorkspace(inactive);
    Assert.ok(!light.isDarkMode, "The inactive space starts in light mode");
    await SpecialPowers.pushPrefEnv({
      set: [["zen.view.window.scheme", 0]],
    });
    try {
      const dark = picker.getGradientForWorkspace(inactive);
      Assert.ok(dark.isDarkMode, "The inactive space follows the new scheme");
      Assert.notEqual(
        dark.gradient,
        light.gradient,
        "Its gradient is refreshed"
      );
      Assert.notEqual(
        dark.paletteStyles["--toolbox-textcolor"],
        light.paletteStyles["--toolbox-textcolor"],
        "Its text palette is refreshed"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
  } finally {
    await SpecialPowers.popPrefEnv();
    picker.invalidateGradientCache(inactive.uuid);
  }
});

add_task(async function test_AccentChangeKeepsEditorStateAndRepaintsWindow() {
  await gZenWorkspaces.promiseInitialized;
  const picker = gZenThemePicker;
  const workspace = gZenWorkspaces.getActiveWorkspace();
  const previousTheme = workspace.theme;
  const previousAlgorithm = picker.useAlgo;
  const previousOpacity = picker.currentOpacity;
  workspace.theme = { gradientColors: [], opacity: 0.5 };
  picker.refreshWorkspaceThemes();
  picker.useAlgo = "analogous";
  picker.currentOpacity = 0.73;
  const themeBefore = JSON.stringify(workspace.theme);
  await SpecialPowers.pushPrefEnv({
    set: [["zen.theme.accent-color", "#2468ac"]],
  });
  try {
    const before = picker.getGradientForWorkspace(workspace);
    await SpecialPowers.pushPrefEnv({
      set: [["zen.theme.accent-color", "#ac6824"]],
    });
    try {
      const after = picker.getGradientForWorkspace(workspace);
      Assert.notEqual(
        before.primaryColor,
        after.primaryColor,
        "The accent is refreshed"
      );
      Assert.equal(
        document.documentElement.style.getPropertyValue("--zen-primary-color"),
        after.primaryColor,
        "The active window uses the refreshed workspace accent"
      );
      Assert.equal(
        picker.useAlgo,
        "analogous",
        "The edited algorithm is preserved"
      );
      Assert.equal(
        picker.currentOpacity,
        0.73,
        "The edited opacity is preserved"
      );
      Assert.equal(
        JSON.stringify(workspace.theme),
        themeBefore,
        "Refreshing does not save picker controls into the workspace"
      );
    } finally {
      await SpecialPowers.popPrefEnv();
    }
  } finally {
    await SpecialPowers.popPrefEnv();
    workspace.theme = previousTheme;
    picker.refreshWorkspaceThemes();
    picker.useAlgo = previousAlgorithm;
    picker.currentOpacity = previousOpacity;
  }
});

add_task(async function test_AdvancedThemePreferencesRefreshAllWorkspaces() {
  await gZenWorkspaces.promiseInitialized;
  const picker = gZenThemePicker;
  const active = gZenWorkspaces.getActiveWorkspace();
  const previousTheme = active.theme;
  const inactive = {
    uuid: "test-theme-advanced-preferences",
    theme: gradientTheme("complementary", 40),
  };
  active.theme = gradientTheme("analogous", 60);
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.theme.use-system-colors", false],
      ["zen.theme.dark-mode-bias", "0.2"],
    ],
  });
  try {
    picker.refreshWorkspaceThemes();
    // Prime the lazy getter even on platforms without translucent windows.
    void picker.darkModeBias;
    for (const [pref, value] of [
      ["zen.theme.use-system-colors", true],
      ["zen.theme.dark-mode-bias", "0.8"],
    ]) {
      const beforeActive = picker.getGradientForWorkspace(active);
      const beforeInactive = picker.getGradientForWorkspace(inactive);
      await SpecialPowers.pushPrefEnv({ set: [[pref, value]] });
      try {
        const afterActive = picker.getGradientForWorkspace(active);
        Assert.notEqual(
          afterActive,
          beforeActive,
          `${pref} invalidates the active workspace palette`
        );
        Assert.notEqual(
          picker.getGradientForWorkspace(inactive),
          beforeInactive,
          `${pref} invalidates inactive workspace palettes`
        );
        Assert.equal(
          document.documentElement.style.getPropertyValue(
            "--zen-primary-color"
          ),
          afterActive.primaryColor,
          `${pref} repaints the active window`
        );
      } finally {
        await SpecialPowers.popPrefEnv();
      }
    }
  } finally {
    await SpecialPowers.popPrefEnv();
    active.theme = previousTheme;
    picker.invalidateGradientCache(inactive.uuid);
    picker.refreshWorkspaceThemes();
  }
});
