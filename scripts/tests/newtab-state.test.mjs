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
