import assert from "node:assert/strict";
import test from "node:test";
import { jobOrigin } from "./jobMessageLog.ts";

test("job origin distinguishes a converted estimate from a job created directly", () => {
  assert.equal(jobOrigin({ estimate_id: "est-1" }), "converted_estimate");
  assert.equal(jobOrigin({ estimate_id: "est-1", walkthrough_id: "wt-1" }), "converted_estimate");
  assert.equal(jobOrigin({ walkthrough_id: "wt-1" }), "converted_walkthrough");
  assert.equal(jobOrigin({}), "created");
  assert.equal(jobOrigin({ estimate_id: null, walkthrough_id: null }), "created");
});
