/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Playback stays muted at the tab boundary throughout this test. No audio
// preview is needed to exercise the real media card and preference plumbing.
add_task(async function test_global_media_gain_controls() {
  const pref = "zen.media.volume-gain-percent";
  await SpecialPowers.pushPrefEnv({ set: [[pref, 100]] });
  const originalTab = gBrowser.selectedTab;
  const mediaTab = await addMediaTab();
  mediaTab.toggleMuteAudio();
  await BrowserTestUtils.switchTab(gBrowser, mediaTab);
  try {
    await SpecialPowers.spawn(
      mediaTab.linkedBrowser,
      [VIDEO_SELECTOR],
      async selector => {
        await content.document.querySelector(selector).play();
      }
    );
    await TestUtils.waitForCondition(
      () => mediaTab.linkedBrowser.browsingContext.mediaController.isActive,
      "muted video has an active media controller"
    );
    gZenMediaController.activateMediaControls(
      mediaTab.linkedBrowser.browsingContext.mediaController,
      mediaTab.linkedBrowser
    );
    await BrowserTestUtils.switchTab(gBrowser, originalTab);
    await waitForMediaBarVisible();
    const card = frontMediaCard().element;
    const slider = card.querySelector(".zen-media-gain-slider");
    const reset = card.querySelector(".zen-media-gain-reset");
    is(slider.value, "100", "gain starts at the safe default");
    ok(reset.disabled, "reset is disabled at the default");
    slider.value = "170";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    is(Services.prefs.getIntPref(pref), 170, "slider saves all-tabs gain");
    ok(!reset.disabled, "reset becomes available after boosting");
    Services.prefs.setIntPref(pref, 130);
    is(slider.value, "130", "an external preference change updates the card");
    clickMediaButton("zen-media-gain-reset");
    is(Services.prefs.getIntPref(pref), 100, "reset restores normal gain");
    is(slider.value, "100", "reset updates the slider");
    ok(mediaTab.linkedBrowser.audioMuted, "gain never unmutes playback");
  } finally {
    await pauseVideoIn(mediaTab);
    BrowserTestUtils.removeTab(mediaTab);
    gBrowser.selectedTab = originalTab;
    await SpecialPowers.popPrefEnv();
  }
});
