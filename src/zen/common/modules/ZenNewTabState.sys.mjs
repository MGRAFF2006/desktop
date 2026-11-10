// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Shared validation for both stored data and messages from the page.
export function safeLinkURL(value) {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function cleanState(value) {
  const links = [];
  for (const link of Array.isArray(value?.links)
    ? value.links.slice(0, 12)
    : []) {
    const url = safeLinkURL(link?.url);
    if (url && typeof link.title === "string" && link.title.trim()) {
      links.push({ title: link.title.trim().slice(0, 60), url });
    }
  }
  return {
    links,
    clock: ["system", "12", "24"].includes(value?.clock)
      ? value.clock
      : "system",
    background: ["theme", "daybreak", "nightfall"].includes(value?.background)
      ? value.background
      : "theme",
    focus: typeof value?.focus === "string" ? value.focus.slice(0, 160) : "",
    focusDate:
      typeof value?.focusDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.focusDate)
        ? value.focusDate
        : "",
  };
}
