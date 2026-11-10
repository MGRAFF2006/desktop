// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const $ = (id) => document.getElementById(id);
let sequence = 0;
const pending = new Map();
document.addEventListener("ZenNewTabResponse", (event) => {
  const resolve = pending.get(event.detail.id);
  if (resolve) {
    pending.delete(event.detail.id);
    resolve(event.detail);
  }
});
function request(action, value) {
  return new Promise((resolve) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false });
    }, 10000);
    pending.set(id, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
    document.dispatchEvent(
      new CustomEvent("ZenNewTabRequest", {
        detail: { id, action, value },
      }),
    );
  });
}
function setStatus(id) {
  if (id) {
    document.l10n.setAttributes($("status"), id);
  } else {
    $("status").removeAttribute("data-l10n-id");
    $("status").textContent = "";
  }
}
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
let state;
function tick() {
  const now = new Date();
  $("clock").textContent = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(state?.clock && state.clock !== "system"
      ? { hour12: state.clock === "12" }
      : {}),
  }).format(now);
  $("clock").dateTime = now.toISOString();
  $("date").textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
  }).format(now);
  if (state && state.focusDate !== today()) {
    state.focus = "";
    state.focusDate = today();
    $("focus").value = "";
  }
}
tick();
const timer = setInterval(tick, 15000);
window.addEventListener("pagehide", () => clearInterval(timer), { once: true });

async function save() {
  const result = await request("save", state);
  setStatus(result.ok ? null : "zen-newtab-save-error");
}
function renderLinks() {
  $("links").replaceChildren();
  state.links.forEach((link, index) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.textContent = link.title;
    anchor.rel = "noreferrer";
    const edit = document.createElement("button");
    edit.textContent = "…";
    document.l10n.setAttributes(edit, "zen-newtab-edit", { title: link.title });
    edit.addEventListener("click", () => editLink(index));
    item.append(anchor, edit);
    $("links").append(item);
  });
  $("add-link").disabled = state.links.length >= 12;
}
let editing = null;
function editLink(index = null) {
  editing = index;
  $("link-title").value = state.links[index]?.title ?? "";
  $("link-url").value = state.links[index]?.url ?? "";
  $("delete-link").hidden = index === null;
  $("link-error").hidden = true;
  $("link-dialog").showModal();
  $("link-title").focus();
}
$("add-link").addEventListener("click", () => editLink());
$("cancel-link").addEventListener("click", () => $("link-dialog").close());
$("link-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  let url;
  try {
    url = new URL($("link-url").value);
  } catch {
    // Keep the dialog open with an actionable validation message.
  }
  const title = $("link-title").value.trim();
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !title
  ) {
    $("link-error").hidden = false;
    $("link-url").focus();
    return;
  }
  const link = { title, url: url.href };
  if (editing === null) {
    state.links.push(link);
  } else {
    state.links[editing] = link;
  }
  $("link-dialog").close();
  renderLinks();
  const button =
    $("links").children[editing ?? state.links.length - 1]?.querySelector(
      "button",
    );
  button?.focus();
  await save();
});
$("delete-link").addEventListener("click", async () => {
  state.links.splice(editing, 1);
  $("link-dialog").close();
  renderLinks();
  $("add-link").focus();
  await save();
});
$("background").addEventListener("change", async () => {
  state.background = $("background").value;
  document.documentElement.dataset.background = state.background;
  await save();
});
$("clock-format").addEventListener("change", async () => {
  state.clock = $("clock-format").value;
  tick();
  await save();
});
$("focus").addEventListener("change", async () => {
  state.focus = $("focus").value;
  state.focusDate = today();
  await save();
});
$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await request("search", $("search").value);
  if (!result.ok) {
    setStatus("zen-newtab-search-error");
  }
});
const initial = await request("load");
if (initial.ok) {
  state = initial.state;
  tick();
  $("clock-format").value = state.clock;
  $("clock-format").disabled = false;
  $("focus").value = state.focus;
  $("focus").disabled = false;
  $("background").value = state.background;
  $("background").disabled = false;
  document.documentElement.dataset.background = state.background;
  $("private-note").hidden = !initial.isPrivate;
  renderLinks();
} else {
  setStatus("zen-newtab-load-error");
}
