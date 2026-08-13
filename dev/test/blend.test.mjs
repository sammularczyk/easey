// Run with: node dev/test/blend.test.mjs
// Covers blend()'s hex parsing, interpolation and zero-padding. getTokens()
// isn't tested here — it only reads ui.getThemeColor, which needs Cavalry.

import assert from "node:assert/strict";
import { blend } from "../src/modules/theme.js";

assert.equal(blend("#000000", "#ffffff", 0), "#000000", "t=0 returns from");
assert.equal(blend("#000000", "#ffffff", 1), "#ffffff", "t=1 returns to");
assert.equal(blend("#000000", "#ffffff", 0.5), "#808080", "midpoint rounds up");

// The shadow rings depend on this: a small step toward black off a mid grey.
assert.equal(blend("#292929", "#000000", 0.26), "#1e1e1e");

// Channels below 16 must keep their leading zero or the string is 5 chars.
assert.equal(blend("#0a0b0c", "#0a0b0c", 0.5), "#0a0b0c", "pads single digits");
assert.equal(blend("#ffffff", "#000000", 0.99), "#030303");

// Alpha bytes on the input are ignored rather than shifting the channels.
assert.equal(blend("#2929297f", "#000000ff", 0), "#292929", "ignores alpha byte");

// t outside 0..1 clamps instead of extrapolating past the endpoints.
assert.equal(blend("#000000", "#ffffff", -1), "#000000", "clamps below 0");
assert.equal(blend("#000000", "#ffffff", 2), "#ffffff", "clamps above 1");

console.log("blend: all assertions passed");
