// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

export class ZenNewTabChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (
      event.target !== this.document ||
      !this.document.getElementById("zen-start")
    ) {
      return;
    }
    const { id, action, value } = event.detail ?? {};
    if (
      !Number.isSafeInteger(id) ||
      !["load", "save", "search"].includes(action)
    ) {
      return;
    }
    const result = await this.sendQuery("ZenNewTab:Request", { action, value });
    if (this.contentWindow) {
      this.document.dispatchEvent(
        new this.contentWindow.CustomEvent("ZenNewTabResponse", {
          detail: Cu.cloneInto({ id, ...result }, this.contentWindow),
        }),
      );
    }
  }
}
