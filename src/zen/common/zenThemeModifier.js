/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* INCLUDE THIS FILE AS:
 *   <script src="chrome://browser/content/zenThemeModifier.js"></script>
 *
 * FOR ANY WEBSITE THAT WOULD NEED TO USE THE ACCENT COLOR, ETC
 */
{
  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs"
  );
  const { XPCOMUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/XPCOMUtils.sys.mjs"
  );

  const lazy = {};

  XPCOMUtils.defineLazyPreferenceGetter(
    lazy,
    "elementSeparation",
    "zen.theme.content-element-separation",
    8
  );

  const kZenThemePrefsList = [
    "zen.theme.accent-color",
    "zen.theme.border-radius",
    "zen.theme.content-element-separation",
    "zen.view.window.scheme",
  ];
  const kZenMaxElementSeparation = 12;

  /**
   * ZenThemeModifier controls the application of theme data to the browser,
   * for example, it injects the accent color to the document. This is used
   * because we need a way to apply the accent color without having to worry about
   * shadow roots not inheriting the accent color.
   *
   * note: It must be a Firefox builtin page with access to the browser's configuration
   *  and services.
   */
  window.ZenThemeModifier = {
    _inMainBrowserWindow: false,

    /**
     * Listen for theming updates from the LightweightThemeChild actor, and
     * begin listening to changes in preferred color scheme.
     */
    init() {
      this._inMainBrowserWindow =
        window.location.href == "chrome://browser/content/browser.xhtml";
      this.listenForEvents();
      this.updateAllThemeBasics();
      if (!this._inMainBrowserWindow && document.l10n) {
        // Page Info localizes its root style attribute, replacing inline colors.
        document.l10n.ready.then(() => {
          if (!window.closed) {
            this.updateAllThemeBasics();
          }
        });
      }
    },

    listenForEvents() {
      var handleEvent = this.handleEvent.bind(this);
      // Listen for changes in the accent color and border radius
      for (let pref of kZenThemePrefsList) {
        Services.prefs.addObserver(pref, handleEvent);
      }

      const contentThemeHandler = () => {
        this.updateAccentColor();
        this.updateWindowScheme();
      };
      if (!this._inMainBrowserWindow) {
        this._forcedColors = window.matchMedia("(forced-colors: active)");
        this._forcedColors.addEventListener("change", contentThemeHandler);
      }

      // Add fullscreen listener to update the theme when going in and out of fullscreen
      const eventsForSeparation = [
        "ZenViewSplitter:SplitViewDeactivated",
        "ZenViewSplitter:SplitViewActivated",
        "fullscreen",
        "ZenCompactMode:Toggled",
        "MozDOMFullscreen:Entered",
        "MozDOMFullscreen:Exited",
      ];
      const separationHandler = this.updateElementSeparation.bind(this);
      for (let eventName of eventsForSeparation) {
        window.addEventListener(eventName, separationHandler, {
          capture: true,
        });
      }

      window.addEventListener(
        "unload",
        () => {
          for (let pref of kZenThemePrefsList) {
            Services.prefs.removeObserver(pref, handleEvent);
          }
          this._forcedColors?.removeEventListener(
            "change",
            contentThemeHandler
          );
          for (let eventName of eventsForSeparation) {
            window.removeEventListener(eventName, separationHandler, {
              capture: true,
            });
          }
        },
        { once: true }
      );
    },

    handleEvent(_subject, _topic, pref) {
      switch (pref) {
        case "zen.theme.accent-color":
          this.updateAccentColor();
          break;
        case "zen.theme.border-radius":
          this.updateBorderRadius();
          break;
        case "zen.theme.content-element-separation":
          this.updateElementSeparation();
          break;
        case "zen.view.window.scheme":
          this.updateWindowScheme();
          break;
      }
    },

    /**
     * Update all theme basics, like the accent color.
     */
    async updateAllThemeBasics() {
      this.updateAccentColor();
      this.updateBorderRadius();
      this.updateElementSeparation();
      this.updateWindowScheme();
    },

    updateWindowScheme() {
      if (this._inMainBrowserWindow) {
        return;
      }
      const scheme = window.docShell?.QueryInterface(Ci.nsILoadContext)
        .usePrivateBrowsing
        ? 0
        : Services.prefs.getIntPref("zen.view.window.scheme", 2);
      if (this._forcedColors.matches || ![0, 1].includes(scheme)) {
        document.documentElement.style.removeProperty("color-scheme");
      } else {
        document.documentElement.style.colorScheme =
          scheme === 0 ? "dark" : "light";
      }
    },

    updateBorderRadius() {
      const borderRadius = Services.prefs.getIntPref(
        "zen.theme.border-radius",
        -1
      );

      // -1 is the default value, will use platform-native values
      // otherwise, use the custom value
      if (borderRadius == -1) {
        if (AppConstants.platform == "macosx") {
          const targetRadius = window.matchMedia("(-moz-mac-tahoe-theme)")
            .matches
            ? 11
            : 10;
          document.documentElement.style.setProperty(
            "--zen-border-radius",
            targetRadius + "px"
          );
        } else if (AppConstants.platform == "linux") {
          // Linux uses GTK CSD titlebar radius, default to 8px
          document.documentElement.style.setProperty(
            "--zen-border-radius",
            "env(-moz-gtk-csd-titlebar-radius, 8px)"
          );
        } else {
          // Windows defaults to 8px
          document.documentElement.style.setProperty(
            "--zen-border-radius",
            "9px"
          );
        }
      } else {
        // Use the overridden value
        document.documentElement.style.setProperty(
          "--zen-border-radius",
          borderRadius + "px"
        );
      }
    },

    /**
     * @param {Event|undefined} event - The event that triggered the update, if any.
     *  If the event is a fullscreen change event, the element separation will be updated accordingly.
     */
    updateElementSeparation(event = undefined) {
      const kMinElementSeparation = 0.1; // in px
      let separation = this.elementSeparation;
      let domFullscreen =
        event?.type === "MozDOMFullscreen:Entered" ||
        document.documentElement.hasAttribute("inDOMFullscreen");
      if (
        document.documentElement.hasAttribute("inFullscreen") &&
        (!domFullscreen || event?.type === "MozDOMFullscreen:Exited") &&
        window.gZenCompactModeManager?.preference &&
        !document
          .getElementById("tabbrowser-tabbox")
          ?.hasAttribute("zen-split-view") &&
        Services.prefs.getBoolPref("zen.view.borderless-fullscreen", true)
      ) {
        separation = 0;
      }
      // In order to still use it on fullscreen, even if it's 0px, add .1px (almost invisible)
      separation = Math.max(kMinElementSeparation, separation);
      document.documentElement.style.setProperty(
        "--zen-element-separation",
        separation + "px"
      );
      if (separation == kMinElementSeparation) {
        document.documentElement.setAttribute("zen-no-padding", true);
      } else {
        document.documentElement.removeAttribute("zen-no-padding");
      }
      if (domFullscreen) {
        const selectedBrowser = gBrowser.selectedBrowser;
        selectedBrowser.style.paddingRight = "0.5px";
        window.addEventListener(
          "MozAfterPaint",
          () => {
            selectedBrowser.style.paddingRight = "";
          },
          { once: true }
        );
      }
    },

    get elementSeparation() {
      return Math.min(lazy.elementSeparation, kZenMaxElementSeparation);
    },

    /**
     * Update the accent color.
     */
    updateAccentColor() {
      // Once initialized, the workspace picker owns the browser's derived
      // accent and refreshes it when the accent preference changes.
      if (
        this._inMainBrowserWindow &&
        window.gZenThemePicker?.promiseInitialized
      ) {
        return;
      }
      const accentColor = this._forcedColors?.matches
        ? "AccentColor"
        : Services.prefs.getStringPref("zen.theme.accent-color");
      document.documentElement.style.setProperty(
        "--zen-primary-color",
        accentColor
      );
    },
  };

  if (typeof Services !== "undefined") {
    ZenThemeModifier.init();
  }
}
