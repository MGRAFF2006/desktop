/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function actorFixture() {
  let resolve;
  let reject;
  const lookup = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let invalidDocumentReads = 0;
  let overlays = 0;
  const document = {
    querySelector: () => ({}),
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    Ci: { nsIStyleSheetService: { USER_SHEET: 1 } },
    Cu: { isDeadWrapper: () => false },
    ChromeUtils: {
      defineESModuleGetters(target) {
        target.ZapOverlay = class {
          constructor() {
            overlays++;
          }
          initialize() {}
        };
      },
    },
    JSWindowActorChild: class {
      manager = { isCurrentGlobal: true, isClosed: false };
      browsingContext = {
        topWindow: { location: { host: "example.com" } },
      };
      get document() {
        if (!this.manager || !this.manager.isCurrentGlobal) {
          invalidDocumentReads++;
          throw Object.assign(new Error("Actor document is unavailable"), {
            name: "InvalidStateError",
          });
        }
        return document;
      }
      sendQuery() {
        return lookup;
      }
      sendAsyncMessage() {}
    },
  });
  const source = readFileSync(
    process.env.ZEN_BOOSTS_CHILD_SOURCE ||
      new URL("../actors/ZenBoostsChild.sys.mjs", import.meta.url),
    "utf8"
  );
  vm.runInContext(
    source.replace("export class ZenBoostsChild", "class ZenBoostsChild") +
      "\nglobalThis.actor = new ZenBoostsChild();",
    context
  );
  return {
    actor: context.actor,
    resolve,
    reject,
    invalidDocumentReads: () => invalidDocumentReads,
    overlays: () => overlays,
  };
}

const focus = { name: "ZenBoost:ToggleZapMode", data: { mode: "focus" } };

test("focus lookup aborted by destruction cannot resume document access", async () => {
  const fixture = actorFixture();
  const completion = fixture.actor.receiveMessage(focus);
  // Gecko invokes didDestroy before clearing the actor's manager.
  fixture.actor.didDestroy();
  fixture.actor.manager = null;
  fixture.reject(
    Object.assign(new Error("Document destroyed"), { name: "AbortError" })
  );
  await completion;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.invalidDocumentReads(), 0);
  assert.equal(fixture.overlays(), 0);
});

test("focus lookup for a non-current document cannot inspect or overlay it", async () => {
  const fixture = actorFixture();
  const completion = fixture.actor.receiveMessage(focus);
  fixture.actor.manager.isCurrentGlobal = false;
  fixture.resolve({ boostEntry: { boostData: { focusSelectors: ["main"] } } });
  await completion;
  assert.equal(fixture.invalidDocumentReads(), 0);
  assert.equal(fixture.overlays(), 0);
});

test("focus lookup failures on a live actor reject the message", async () => {
  const fixture = actorFixture();
  const completion = fixture.actor.receiveMessage(focus);
  const error = new Error("Unexpected query failure");
  fixture.reject(error);
  await assert.rejects(completion, failure => failure === error);
  assert.equal(fixture.overlays(), 0);
});

test("live focus with no saved selectors still opens its overlay", async () => {
  const fixture = actorFixture();
  const completion = fixture.actor.receiveMessage(focus);
  fixture.resolve(null);
  await completion;
  assert.equal(fixture.overlays(), 1);
  assert.equal(fixture.invalidDocumentReads(), 0);
});
