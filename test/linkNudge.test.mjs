import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_LINK_NUDGE,
  applyAccountLinkNudge,
} from "../dist/linkNudge.js";

test("resolve_prompt remains byte-for-byte unchanged and does not consume the nudge", () => {
  const result = {
    content: [{ type: "text", text: "SYSTEM PROMPT\n\nDo the work exactly." }],
  };
  const before = JSON.stringify(result);

  const outcome = applyAccountLinkNudge("resolve_prompt", result);

  assert.equal(outcome.consumed, false);
  assert.strictEqual(outcome.result, result);
  assert.equal(JSON.stringify(outcome.result), before);
});

test("display-only discovery responses receive the nudge without mutating the original", () => {
  const result = {
    content: [{ type: "text", text: "Found 1 prompt" }],
  };

  const outcome = applyAccountLinkNudge("list_prompts", result);

  assert.equal(outcome.consumed, true);
  assert.notStrictEqual(outcome.result, result);
  assert.deepEqual(result.content, [{ type: "text", text: "Found 1 prompt" }]);
  assert.deepEqual(outcome.result.content, [
    { type: "text", text: "Found 1 prompt" },
    { type: "text", text: ACCOUNT_LINK_NUDGE },
  ]);
});

test("get_account_link consumes the nudge without duplicating its response", () => {
  const result = {
    content: [{ type: "text", text: "Open https://gildara.io/link?code=abc" }],
  };
  const before = JSON.stringify(result);

  const outcome = applyAccountLinkNudge("get_account_link", result);

  assert.equal(outcome.consumed, true);
  assert.strictEqual(outcome.result, result);
  assert.equal(JSON.stringify(outcome.result), before);
});

test("errors do not consume the nudge", () => {
  const result = {
    isError: true,
    content: [{ type: "text", text: "temporarily unavailable" }],
  };

  const outcome = applyAccountLinkNudge("list_prompts", result);

  assert.equal(outcome.consumed, false);
  assert.strictEqual(outcome.result, result);
});
