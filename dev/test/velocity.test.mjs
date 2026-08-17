// Run with: node dev/test/velocity.test.mjs
// Covers cubicBezierToVelocity's frame-rate-aware influence floor. The floor exists
// because influence is a fraction of the segment: below 1/frameDiff it describes a ramp
// narrower than one frame, and Cavalry crushes the whole ramp into the final frame as a
// jump. Measured on the 70-frame segment that prompted the fix.

import assert from "node:assert/strict";
import { cubicBezierToVelocity, velocityToCubicBezier } from "../src/modules/conversions.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// The reported case: x2 = 0.991 asks for 0.009 of a 70-frame segment = 0.63 frames.
const v = cubicBezierToVelocity(0.458, 0.146, 0.991, 0.472, 70);
near(v.leftInfluence, 1 / 70, "influence rounds up to one frame");
near(v.rightInfluence, 0.458, "a roomy influence is left alone");

// Raising the influence must slide the control point in x only. Its y is what sets how
// hard the curve eases, and dividing by the raw influence would drag it down with it.
const back = velocityToCubicBezier(v.rightSpeed, v.rightInfluence, v.leftSpeed, v.leftInfluence);
near(back.y1, 0.146, "y1 survives the clamp");
near(back.y2, 0.472, "y2 survives the clamp");
near(back.x2, 1 - 1 / 70, "x2 slides to the one-frame boundary");

// A longer segment resolves a ramp the short one couldn't: 0.02 is 10 frames of 500.
const long = cubicBezierToVelocity(0.458, 0.146, 0.98, 0.472, 500);
near(long.leftInfluence, 0.02, "500 frames resolves 0.02 without help");

// The hard 0.01 floor still wins once 1/frameDiff drops below it — Cavalry rejects
// influence under 0.01 no matter how many frames the segment spans.
const veryLong = cubicBezierToVelocity(0.458, 0.146, 0.991, 0.472, 500);
near(veryLong.leftInfluence, 0.01, "0.01 remains the absolute floor");

// Round-trips untouched when every value is comfortably in range.
const mid = cubicBezierToVelocity(0.25, 0.1, 0.25, 1.0, 60);
const midBack = velocityToCubicBezier(mid.rightSpeed, mid.rightInfluence, mid.leftSpeed, mid.leftInfluence);
near(midBack.x1, 0.25, "x1 round-trips");
near(midBack.y1, 0.1, "y1 round-trips");
near(midBack.x2, 0.25, "x2 round-trips");
near(midBack.y2, 1.0, "y2 round-trips");

// frameDiff omitted (single-value attributes never call this, but don't blow up).
const noFrames = cubicBezierToVelocity(0.458, 0.146, 0.991, 0.472);
near(noFrames.leftInfluence, 0.01, "missing frameDiff falls back to the hard floor");

// A zero-length outgoing handle must not divide by zero.
const flat = cubicBezierToVelocity(0, 0, 1, 1, 70);
assert.ok(Number.isFinite(flat.rightSpeed), "rightSpeed stays finite at x1 = 0");
assert.ok(Number.isFinite(flat.leftSpeed), "leftSpeed stays finite at x2 = 1");

console.log("velocity: ok");
