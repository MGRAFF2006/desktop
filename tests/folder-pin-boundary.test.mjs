import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Firefox owns this class, so source is shipped as an upstream patch. Compile
// its real new-side methods rather than maintaining a parallel implementation.
const patch = readFileSync(
  new URL(
    "../src/browser/components/tabbrowser/Tabbrowser-sys-mjs.patch",
    import.meta.url
  ),
  "utf8"
);
const source = patch
  .split("\n")
  .filter(
    line =>
      !line.startsWith("+++") && (line.startsWith("+") || line.startsWith(" "))
  )
  .map(line => line.slice(1))
  .join("\n");
function method(name) {
  const start = source.indexOf(`  ${name}`);
  assert(start >= 0);
  const body = source.indexOf("{", start);
  let depth = 1,
    end = body + 1;
  while (depth) {
    if (source[end] === "{") depth++;
    if (source[end++] === "}") depth--;
  }
  return source.slice(start, end);
}
const NativeContracts = Function(`return class Tabbrowser {
  static isTabGroupLabel(item) { return !!item?.isLabel; }
  ${method("zenIsInPinnedSection(")}
  ${method("zenPinnedBoundary(")}
  ${method("get pinnedTabCount()")}
}`)();
function item(pinned, group = null, attributes = []) {
  return { pinned, group, hasAttribute: name => attributes.includes(name) };
}
function browser(tabs) {
  const result = new NativeContracts();
  result.tabs = tabs;
  result.documentGlobal = {
    gZenGlanceManager: { getTabOrGlanceParent: item => item },
  };
  return result;
}

test("native pin count counts real flags after ordinary children without treating placeholders as tabs", () => {
  const pinnedRoot = item(true),
    regularRoot = item(false);
  const tabs = [
    item(true, pinnedRoot),
    item(false, pinnedRoot),
    item(false, regularRoot),
    item(true, regularRoot),
    item(true, pinnedRoot, ["zen-empty-tab"]),
    item(true, null, ["zen-glance-tab"]),
  ];
  assert.equal(browser(tabs).pinnedTabCount, 2);
});

test("native placement boundaries use each supplied array and the outermost folder", () => {
  const pinnedRoot = item(true),
    ordinaryRoot = item(false);
  const nested = item(true, ordinaryRoot);
  const pinnedChild = item(true, pinnedRoot),
    ordinaryChild = item(false, pinnedRoot),
    laterPin = item(true, nested);
  const native = browser([pinnedChild, ordinaryChild, laterPin]);
  assert.equal(native.zenPinnedBoundary(native.tabs), 2);
  const labels = [
    { isLabel: true, group: pinnedRoot },
    pinnedChild,
    ordinaryChild,
    { isLabel: true, group: ordinaryRoot },
    laterPin,
  ];
  assert.equal(native.zenPinnedBoundary(labels), 3);
  assert.equal(native.zenIsInPinnedSection(laterPin), false);
  assert.equal(native.zenPinnedBoundary([pinnedChild, ordinaryChild]), 2);
  assert.equal(native.zenPinnedBoundary([]), 0);
});
