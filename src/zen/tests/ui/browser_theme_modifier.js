/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_geometry_changes_preserve_workspace_accent() {
  await gZenWorkspaces.promiseInitialized;
  await gZenThemePicker.promiseInitialized;
  const style = document.documentElement.style;
  const accent = "rgb(120, 40, 200)";
  const properties = [
    "--zen-primary-color",
    "--zen-border-radius",
    "--zen-element-separation",
  ];
  const previous = properties.map(property => style.getPropertyValue(property));
  try {
    style.setProperty("--zen-primary-color", accent);
    await SpecialPowers.pushPrefEnv({
      set: [
        ["zen.theme.border-radius", 14],
        ["zen.theme.content-element-separation", 6],
      ],
    });
    Assert.equal(style.getPropertyValue("--zen-border-radius"), "14px");
    Assert.equal(style.getPropertyValue("--zen-element-separation"), "6px");
    Assert.equal(
      style.getPropertyValue("--zen-primary-color"),
      accent,
      "Geometry changes preserve the workspace's derived accent"
    );
    ZenThemeModifier.updateAllThemeBasics();
    Assert.equal(
      style.getPropertyValue("--zen-primary-color"),
      accent,
      "Refreshing theme basics preserves the initialized picker's accent"
    );
  } finally {
    await SpecialPowers.popPrefEnv();
    properties.forEach((property, index) => {
      if (previous[index]) {
        style.setProperty(property, previous[index]);
      } else {
        style.removeProperty(property);
      }
    });
  }
});
