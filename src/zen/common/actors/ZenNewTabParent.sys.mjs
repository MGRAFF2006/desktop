// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { cleanState } from "resource:///modules/ZenNewTabState.sys.mjs";

const PREF = "zen.newtab.state";

export class ZenNewTabParent extends JSWindowActorParent {
  #privateState = cleanState(null);

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
          let state = this.#privateState;
          if (!isPrivate) {
            const stored = Services.prefs.getStringPref(PREF, "{}");
            try {
              state = cleanState(JSON.parse(stored));
            } catch {
              state = cleanState(null);
            }
          }
          return { ok: true, state, isPrivate };
        }
        case "save": {
          const state = cleanState(data.value);
          if (isPrivate) {
            this.#privateState = state;
          } else {
            Services.prefs.setStringPref(PREF, JSON.stringify(state));
          }
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
          await Services.search.init();
          const engine = isPrivate
            ? await Services.search.getDefaultPrivate()
            : await Services.search.getDefault();
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
          browser.ownerGlobal.openTrustedLinkIn(
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
