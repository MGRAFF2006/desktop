// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

export class ZenInternalThemeChild extends JSWindowActorChild {
  #theme = null;
  #forcedColors = null;

  handleEvent() {
    if (!this.#forcedColors) {
      this.#forcedColors = this.contentWindow.matchMedia(
        "(forced-colors: active)"
      );
      this.#forcedColors.addEventListener("change", this);
      this.sendAsyncMessage("ZenInternalTheme:Ready");
    }
    this.#applyTheme();
  }

  receiveMessage({ name, data }) {
    if (name === "ZenInternalTheme:Update") {
      this.#theme = data;
      this.#applyTheme();
    }
  }

  #applyTheme() {
    const root = this.document.documentElement;
    if (!root || !this.#theme) {
      return;
    }
    const forcedColors = this.#forcedColors?.matches;
    root.style.setProperty(
      "--zen-primary-color",
      forcedColors ? "AccentColor" : this.#theme.accent
    );
    if (forcedColors || this.#theme.scheme === 2) {
      root.style.removeProperty("color-scheme");
    } else {
      root.style.colorScheme = this.#theme.scheme === 0 ? "dark" : "light";
    }
  }

  didDestroy() {
    this.#forcedColors?.removeEventListener("change", this);
  }
}
