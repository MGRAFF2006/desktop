/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

class Element {
  constructor(id, kind = "folder", attrs = {}) {
    this.id = id;
    this.kind = kind;
    this.attrs = { id, ...attrs };
    this.children = [];
    this.pinned = false;
    this.isZenFolder = kind === "folder";
    this.classList = { contains: name => kind === name };
  }
  get group() {
    return this.parentNode?.owner ?? null;
  }
  get previousElementSibling() {
    return (
      this.parentNode?.children[this.parentNode.children.indexOf(this) - 1] ??
      null
    );
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name) {
    return name in this.attrs;
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  insertBefore(item, before) {
    if (item.parentNode) {
      item.parentNode.children.splice(
        item.parentNode.children.indexOf(item),
        1
      );
    }
    item.parentNode = this;
    this.children.splice(
      before ? this.children.indexOf(before) : this.children.length,
      0,
      item
    );
  }
  after(item) {
    const next =
      this.parentNode.children[this.parentNode.children.indexOf(this) + 1];
    this.parentNode.insertBefore(item, next);
  }
  appendChild(item) {
    this.insertBefore(item, null);
  }
}

function setup() {
  const root = new Element("regular", "container");
  const pinned = new Element("pins", "container");
  const marker = new Element("marker", "space-fake-collapsible-start");
  root.appendChild(marker);
  const target = new Element("moving");
  pinned.appendChild(target);
  const items = new Map([[target.id, target]]);
  const sourceWindow = { gZenWorkspaces: { activeWorkspace: "workspace" } };
  const win = {
    document: { getElementById: id => items.get(id) },
    gZenWorkspaces: {
      workspaceElement: () => ({
        tabsContainer: root,
        pinnedTabsContainer: pinned,
      }),
    },
    gBrowser: {
      isTab: item => item?.kind === "tab",
      isTabGroup: item => item?.kind === "folder",
      zenHandleTabMove: (item, callback) => callback(),
      tabContainer: { tabDragAndDrop: { handle_drop_transition() {} } },
    },
  };
  const lazyValues = {
    BrowserWindowTracker: { orderedWindows: [sourceWindow, win] },
    SessionStore: { getWindowId: () => "window" },
  };
  const context = vm.createContext({
    console,
    ChromeUtils: {
      defineESModuleGetters: (object, modules) => {
        for (const name of Object.keys(modules)) {
          Object.defineProperty(object, name, { get: () => lazyValues[name] });
        }
      },
    },
    XPCOMUtils: {
      defineLazyPreferenceGetter: (object, name) => {
        object[name] = true;
      },
    },
  });
  const source = readFileSync(
    new URL("../ZenWindowSync.sys.mjs", import.meta.url),
    "utf8"
  )
    .replace(/^import .*;\n/m, "")
    .replace(/\bexport /g, "");
  vm.runInContext(source + "\nglobalThis.sync = ZenWindowSync;", context);
  const original = new Element("moving", "folder", {
    "zen-workspace-id": "workspace",
  });
  original.documentGlobal = sourceWindow;
  return {
    root,
    marker,
    pinned,
    target,
    items,
    original,
    move: () => context.sync.on_TabMove({ target: original }),
  };
}

test("shared folder skips a missing ordinary neighbour and follows the nearest shared row", async () => {
  const { root, target, items, original, move } = setup();
  const shared = new Element("shared");
  root.appendChild(shared);
  items.set(shared.id, shared);
  const sourceParent = new Element("source", "container");
  sourceParent.appendChild(new Element("shared"));
  sourceParent.appendChild(new Element("local-tab", "tab"));
  sourceParent.appendChild(original);
  await move();
  assert.equal(
    target.parentNode,
    root,
    "the folder leaves its previous parent"
  );
  assert.equal(
    target.previousElementSibling,
    shared,
    "an excluded tab cannot suppress the folder move"
  );
});

test("a folder with only excluded predecessors reparents after the destination placeholder", async () => {
  const { target, items, original, move } = setup();
  const parent = new Element("parent");
  parent.groupContainer = new Element("content", "container");
  parent.groupContainer.owner = parent;
  const placeholder = new Element("placeholder", "tab", {
    "zen-empty-tab": true,
  });
  parent.groupContainer.appendChild(placeholder);
  items.set(parent.id, parent);
  const sourceParent = new Element("source-content", "container");
  sourceParent.owner = new Element("parent");
  sourceParent.appendChild(new Element("local-tab", "tab"));
  sourceParent.appendChild(original);
  await move();
  assert.equal(target.parentNode, parent.groupContainer);
  assert.equal(
    target.previousElementSibling,
    placeholder,
    "the anchor stays first during reparenting"
  );
});

test("moving back to workspace root preserves its leading structural marker", async () => {
  const { root, marker, target, original, move } = setup();
  const existing = new Element("existing");
  root.appendChild(existing);
  const sourceParent = new Element("source", "container");
  sourceParent.appendChild(
    new Element("source-marker", "space-fake-collapsible-start")
  );
  sourceParent.appendChild(new Element("local-tab", "tab"));
  sourceParent.appendChild(original);
  await move();
  assert.equal(target.parentNode, root);
  assert.deepEqual(
    root.children,
    [marker, target, existing],
    "real rows follow the root marker"
  );
});
