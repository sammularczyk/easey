// Run with: node dev/test/tangentMatch.test.mjs
// Covers clicking a ghost curve to rotate the adjoining handle onto the neighbour's tangent.
//
// The claim being tested: matching the ANGLE matches the speed across the join. A bezier's
// endpoint tangent is 3(P1 - P0), so its slope depends only on the handle's direction — the
// length cancels. So the handle keeps whatever length the user gave it, and only turns.

import assert from "node:assert/strict";
import { tangentMatchedHandle, neighbourCurveControlPoints } from "../src/modules/conversions.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// The plot rect drawCurve builds from GRAPH_CONFIG. ui.Draw is y-up: endY is the BOTTOM.
const bounds = { startX: 30, startY: 200, endX: 200, endY: 30 };
const width = bounds.endX - bounds.startX;   // 170
const height = bounds.startY - bounds.endY;  // 170

// Slope of the selected curve leaving/arriving at the shared corner, in pixels.
const outSlope = e => (e.y1 * height) / (e.x1 * width);
const inSlope = e => ((1 - e.y2) * height) / ((1 - e.x2) * width);

// Slope the ghost is travelling at the corner it shares with the selection.
const prevArrivalSlope = p => (p.p3[1] - p.cp2[1]) / (p.p3[0] - p.cp2[0]);
const nextDepartureSlope = p => (p.cp1[1] - p.p0[1]) / (p.cp1[0] - p.p0[0]);

const sel = { frameDiff: 20, valueDiff: 100 };
const start = { x1: 0.4, y1: 0.05, x2: 0.6, y2: 0.95 };

// --- prev: the outgoing handle turns to continue the neighbour's arrival ---
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: { x1: 0.2, y1: 0.1, x2: 0.5, y2: 0.7 } };
    const points = neighbourCurveControlPoints("prev", sel, seg, bounds);

    const got = tangentMatchedHandle("prev", points, bounds, start);
    near(outSlope({ ...start, ...got }), prevArrivalSlope(points), "outgoing handle matches the arrival slope");

    // Only the angle changes: the handle keeps the length it had.
    const before = Math.hypot(start.x1 * width, start.y1 * height);
    const after = Math.hypot(got.x1 * width, got.y1 * height);
    near(after, before, "handle length is preserved");

    assert.equal(got.x2, undefined, "prev leaves the incoming handle alone");
}

// --- next: the incoming handle turns to lead into the neighbour's departure ---
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: { x1: 0.3, y1: 0.6, x2: 0.8, y2: 0.9 } };
    const points = neighbourCurveControlPoints("next", sel, seg, bounds);

    const got = tangentMatchedHandle("next", points, bounds, start);
    near(inSlope({ ...start, ...got }), nextDepartureSlope(points), "incoming handle matches the departure slope");

    const before = Math.hypot((1 - start.x2) * width, (1 - start.y2) * height);
    const after = Math.hypot((1 - got.x2) * width, (1 - got.y2) * height);
    near(after, before, "handle length is preserved");

    assert.equal(got.x1, undefined, "next leaves the outgoing handle alone");
}

// --- time must keep running forwards ---
// A shallow neighbour tangent with a long handle would push x past the plot edge, folding the
// curve. The handle shortens instead of bending, so the angle survives and x stays in range.
{
    const flat = { frameDiff: 20, valueDiff: 100, easing: { x1: 0.9, y1: 0.0, x2: 1.0, y2: 0.0 } };
    const longHandle = { x1: 0.99, y1: 0.001, x2: 0.01, y2: 0.999 };

    const prev = tangentMatchedHandle("prev", neighbourCurveControlPoints("prev", sel, flat, bounds), bounds, longHandle);
    assert.ok(prev.x1 >= 0 && prev.x1 <= 1, `x1 stays in range: ${prev.x1}`);

    const next = tangentMatchedHandle("next", neighbourCurveControlPoints("next", sel, flat, bounds), bounds, longHandle);
    assert.ok(next.x2 >= 0 && next.x2 <= 1, `x2 stays in range: ${next.x2}`);
}

// A handle already flattened onto the keyframe has no length to preserve, so it takes a
// sensible default rather than collapsing to a zero-length handle that can never be grabbed.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: { x1: 0.2, y1: 0.1, x2: 0.5, y2: 0.7 } };
    const points = neighbourCurveControlPoints("prev", sel, seg, bounds);
    const got = tangentMatchedHandle("prev", points, bounds, { x1: 0, y1: 0, x2: 1, y2: 1 });
    assert.ok(Math.hypot(got.x1 * width, got.y1 * height) > 0, "a flat handle gains a usable length");
    near(outSlope({ x2: 1, y2: 1, ...got }), prevArrivalSlope(points), "and still matches the slope");
}

// Malformed input declines rather than throwing.
assert.equal(tangentMatchedHandle("prev", null, bounds, start), null, "no ghost points");
assert.equal(tangentMatchedHandle("prev", { p0: [0, 0], cp1: [0, 0], cp2: [0, 0], p3: [0, 0] }, bounds, start), null, "zero-length tangent");

console.log("tangentMatch: ok");
