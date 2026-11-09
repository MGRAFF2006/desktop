// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const THEME_PREFS = ["zen.theme.accent-color", "zen.view.window.scheme"];

export class ZenInternalThemeParent extends JSWindowActorParent {
  #ready = false;
  #onPreferenceChange = () => this.observe();

  receiveMessage({ name }) {
    if (name !== "ZenInternalTheme:Ready" || this.#ready) {
      return;
    }
    this.#ready = true;
    for (const pref of THEME_PREFS) {
      Services.prefs.addObserver(pref, this.#onPreferenceChange);
    }
    this.observe();
  }

  observe() {
    const accent = Services.prefs.getStringPref(
      "zen.theme.accent-color",
      "AccentColor"
    );
    const scheme = Services.prefs.getIntPref("zen.view.window.scheme", 2);
    this.sendAsyncMessage("ZenInternalTheme:Update", {
      accent: /^(?:AccentColor|#[\da-f]{3}|#[\da-f]{6})$/i.test(accent)
        ? accent
        : "AccentColor",
      scheme: this.browsingContext.originAttributes.privateBrowsingId
        ? 0
        : [0, 1, 2].includes(scheme)
          ? scheme
          : 2,
    });
  }

  didDestroy() {
    if (this.#ready) {
      for (const pref of THEME_PREFS) {
        Services.prefs.removeObserver(pref, this.#onPreferenceChange);
      }
      this.#ready = false;
    }
  }
}
