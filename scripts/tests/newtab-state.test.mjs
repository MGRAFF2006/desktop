// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanState,
  safeLinkURL,
} from "../../src/zen/common/modules/ZenNewTabState.sys.mjs";

test("quicklinks reject executable, local, privileged and credential-bearing URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "chrome://browser/content/browser.xhtml",
    "resource://gre/modules/Services.sys.mjs",
    "about:config",
    "https://name:secret@example.com",
    "//example.com",
    "not a URL",
  ]) {
    assert.equal(safeLinkURL(url), null, url);
  }
  assert.equal(safeLinkURL("https://example.com"), "https://example.com/");
  assert.equal(
    safeLinkURL("http://localhost:8080/path?q=test"),
    "http://localhost:8080/path?q=test",
  );
});

test("stored state is bounded, tolerates corruption and uses only local background presets", () => {
  assert.deepEqual(cleanState(null), {
    links: [],
    clock: "system",
    background: "theme",
    focus: "",
    focusDate: "",
  });
  const state = cleanState({
    background: "https://remote.example/image.jpg",
    links: [
      null,
      { title: "No script", url: "javascript:alert(1)" },
      { title: "  My link  ", url: "https://example.com" },
    ],
    focus: "x".repeat(200),
    focusDate: "2026-11-10",
  });
  assert.deepEqual(state.links, [
    { title: "My link", url: "https://example.com/" },
  ]);
  assert.equal(state.background, "theme");
  assert.equal(state.focus.length, 160);
  assert.equal(state.focusDate, "2026-11-10");
  assert.equal(
    cleanState({
      links: Array(20).fill({ title: "Link", url: "https://example.com" }),
    }).links.length,
    12,
  );
});

test("a stale document cannot overwrite newer settings from another page", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  let stored = "{}";
  const source = readFileSync(
    new URL(
      "../../src/zen/common/actors/ZenNewTabParent.sys.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const Parent = vm.runInNewContext(
    source.replace(/^import .*;\n/gm, "").replace("export class", "class") +
      "\nZenNewTabParent;",
    {
      cleanState,
      JSWindowActorParent: class {},
      Services: {
        prefs: {
          getStringPref: () => stored,
          setStringPref: (_name, value) => {
            stored = value;
          },
        },
      },
      console,
    },
  );
  const actor = () => {
    const value = new Parent();
    value.manager = { documentPrincipal: { URI: { spec: "about:newtab" } } };
    value.browsingContext = { originAttributes: { privateBrowsingId: 0 } };
    return value;
  };
  const request = (parent, action, value) =>
    parent.receiveMessage({
      name: "ZenNewTab:Request",
      data: { action, value },
    });
  const first = actor(),
    second = actor();
  const firstState = (await request(first, "load")).state;
  const secondState = (await request(second, "load")).state;
  firstState.links.push({ title: "Saved first", url: "https://example.com/" });
  assert.equal((await request(first, "save", firstState)).ok, true);
  secondState.clock = "24";
  const stale = await request(second, "save", secondState);
  assert.equal(stale.ok, false, "stale snapshots are rejected");
  assert.equal(stale.conflict, true);
  assert.equal(JSON.parse(stored).links[0].title, "Saved first");
  const refreshed = (await request(second, "load")).state;
  refreshed.clock = "24";
  assert.equal((await request(second, "save", refreshed)).ok, true);
  assert.equal(JSON.parse(stored).links[0].title, "Saved first");
  assert.equal(JSON.parse(stored).clock, "24");
  firstState.links = [];
  assert.equal(
    (await request(first, "save", firstState)).ok,
    false,
    "stale link edits cannot replace newer settings either",
  );
});
