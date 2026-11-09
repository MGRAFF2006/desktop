// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";
import { ShortcutUtils } from "resource://gre/modules/ShortcutUtils.sys.mjs";

const PREF = "zen.tabs.show-shortcut-hints";
const EVENTS = [
  "TabOpen",
  "TabClose",
  "TabMove",
  "TabPinned",
  "TabUnpinned",
  "TabShow",
  "TabSelect",
  "TabMultiSelect",
  "TabGroupCollapse",
  "TabGroupExpand",
  "TabHide",
  "ZenWorkspacesUIUpdate",
  "AfterWorkspacesSessionRestore",
];

class nsZenTabShortcutHints extends nsZenDOMOperatedFeature {
  #frame = null;
  #observer = null;
  #enabled = false;
  #preferenceChanged = () => this.#updateEnabled();

  init() {
    Services.prefs.addObserver(PREF, this.#preferenceChanged);
    window.addEventListener(
      "unload",
      () => {
        Services.prefs.removeObserver(PREF, this.#preferenceChanged);
        this.#disable();
      },
      { once: true }
    );
    this.#updateEnabled();
  }

  #updateEnabled() {
    const enabled = Services.prefs.getBoolPref(PREF, false);
    if (enabled === this.#enabled) {
      return;
    }
    if (!enabled) {
      this.#disable();
      return;
    }
    this.#enabled = true;
    for (const name of EVENTS) {
      window.addEventListener(name, this, true);
    }
    this.#observer = new MutationObserver(() => this.handleEvent());
    this.#observer.observe(gBrowser.tabContainer, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "collapsed",
        "zen-workspace-id",
        "zen-essential",
        "zen-glance-tab",
      ],
    });
    const keyset = document.getElementById("mainKeyset");
    if (keyset) {
      this.#observer.observe(keyset, {
        subtree: true,
        attributes: true,
        attributeFilter: ["key", "keycode", "modifiers", "disabled"],
      });
    }
    this.handleEvent();
  }

  #disable() {
    this.#enabled = false;
    if (this.#frame !== null) {
      window.cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
    this.#observer?.disconnect();
    this.#observer = null;
    for (const name of EVENTS) {
      window.removeEventListener(name, this, true);
    }
    for (const hint of document.querySelectorAll(".zen-tab-shortcut-hint")) {
      hint.remove();
    }
  }

  handleEvent() {
    if (!this.#enabled || this.#frame !== null) {
      return;
    }
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = null;
      this.update();
    });
  }

  update() {
    if (!this.#enabled) {
      return;
    }
    // Use the same ordered list as selectTabAtIndex; CSS counters also count
    // tabs in other workspaces and can disagree with keyboard navigation.
    const tabs = gBrowser.visibleTabs;
    const targets = new Map(
      tabs.slice(0, 8).map((tab, index) => [tab, index + 1])
    );
    if (tabs.length > 8) {
      targets.set(tabs.at(-1), 9);
    }
    for (const hint of document.querySelectorAll(".zen-tab-shortcut-hint")) {
      if (!targets.has(hint.closest(".tabbrowser-tab"))) {
        hint.remove();
      }
    }
    for (const [tab, number] of targets) {
      const key = document.getElementById(
        number === 9 ? "key_selectLastTab" : `key_selectTab${number}`
      );
      const value = key?.getAttribute("key");
      let hint = tab.querySelector(".zen-tab-shortcut-hint");
      if (!value || key.getAttribute("disabled") === "true" || tab.closing) {
        hint?.remove();
        continue;
      }
      if (!hint) {
        hint = document.createXULElement("label");
        hint.className = "zen-tab-shortcut-hint";
        hint.setAttribute("aria-hidden", "true");
        const content = tab.querySelector(".tab-content");
        content.insertBefore(hint, content.querySelector(".tab-close-button"));
      }
      if (hint.value !== value) {
        hint.value = value;
      }
      hint.setAttribute("tooltiptext", ShortcutUtils.prettifyShortcut(key));
    }
  }
}

window.gZenTabShortcutHints = new nsZenTabShortcutHints();
