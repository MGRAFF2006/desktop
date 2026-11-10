// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { cleanState } from "resource:///modules/ZenNewTabState.sys.mjs";

import { SearchService } from "moz-src:///toolkit/components/search/SearchService.sys.mjs";

const PREF = "zen.newtab.state";

export class ZenNewTabParent extends JSWindowActorParent {
  #privateState = cleanState(null);
  #loadedState = null;

  #readState(isPrivate) {
    if (isPrivate) {
      return this.#privateState;
    }
    try {
      return cleanState(JSON.parse(Services.prefs.getStringPref(PREF, "{}")));
    } catch {
      return cleanState(null);
    }
  }

  async receiveMessage({ name, data }) {
    if (
      name !== "ZenNewTab:Request" ||
      !["about:newtab", "about:home"].includes(
        this.manager.documentPrincipal?.URI?.spec,
      )
    ) {
      return { ok: false };
    }
    const isPrivate = !!this.browsingContext.originAttributes.privateBrowsingId;
    try {
      switch (data.action) {
        case "load": {
          const state = this.#readState(isPrivate);
          this.#loadedState = JSON.stringify(state);
          return { ok: true, state, isPrivate };
        }
        case "save": {
          // Another page may have saved newer links since this document loaded.
          // Keep the comparison and write synchronous so stale edits cannot win.
          if (
            this.#loadedState !== JSON.stringify(this.#readState(isPrivate))
          ) {
            return { ok: false, conflict: true };
          }
          const state = cleanState(data.value);
          if (isPrivate) {
            this.#privateState = state;
          } else {
            Services.prefs.setStringPref(PREF, JSON.stringify(state));
          }
          this.#loadedState = JSON.stringify(state);
          return { ok: true, state };
        }
        case "search": {
          if (
            typeof data.value !== "string" ||
            !data.value.trim() ||
            data.value.length > 2048
          ) {
            return { ok: false };
          }
          await SearchService.init();
          const engine = isPrivate
            ? await SearchService.getDefaultPrivate()
            : await SearchService.getDefault();
          const submission = engine.getSubmission(
            data.value.trim(),
            null,
            "newtab",
          );
          if (
            !submission ||
            !["https", "http"].includes(submission.uri.scheme)
          ) {
            return { ok: false };
          }
          const browser = this.browsingContext.top.embedderElement;
          browser.documentGlobal.openTrustedLinkIn(
            submission.uri.spec,
            "current",
            {
              targetBrowser: browser,
              postData: submission.postData,
            },
          );
          return { ok: true };
        }
      }
    } catch (error) {
      console.error("Zen new tab request failed", error);
    }
    return { ok: false };
  }
}
