// Run with: node dev/test/speedHandles.test.mjs
// The speed graph's handles and its curve have to be the same quantity, or the drawing has to
// be bent to make them meet — which is exactly what drawSpeedCurve used to do. A handle's
// height is the real speed at that keyframe (y1 / x1, rise over run) divided by the peak the
// graph is normalised to. These lock the round trip and the two edits that depend on it:
// dragging a handle, and clicking a neighbour's ghost to match its speed.

import assert from "node:assert/strict";
import { speedCurveGeometry } from "../src/modules/graphRenderer.js";
import {
    speedToCubicBezier,
    speedGhostPolyline,
    calculateVelocityAtTime
} from "../src/modules/conversions.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const config = { width: 230, height: 230, padding: 30 };

// --- round trip: reading the handles off a curve and writing them back changes nothing ---

const easings = [
    { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },       // Ease In Out
    { x1: 0.19, y1: 1, x2: 0.22, y2: 1 },       // Ease Out Expo — steep start
    { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },    // Ease Out Back — y1 above 1
    { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }
];

for (const e of easings) {
    const g = speedCurveGeometry(e, config);
    const back = speedToCubicBezier(g.outInfluence, g.inInfluence, g.outSpeedY, g.inSpeedY, g.scale);
    near(back.x1, e.x1, "x1 round-trips");
    near(back.y1, e.y1, "y1 round-trips");
    near(back.x2, e.x2, "x2 round-trips");
    near(back.y2, e.y2, "y2 round-trips");
}

// --- a drag: the handle lands where the pointer left it -------------------------

// Frozen scale, as onMousePress seeds it. Dropping the out handle at 40% of the plot height
// must put the curve's start at 40% of the plot height, drawn against that same frozen scale.
{
    const e = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
    const seed = speedCurveGeometry(e, config);
    const dropped = speedToCubicBezier(seed.outInfluence, seed.inInfluence, 0.4, seed.inSpeedY, seed.scale);
    const after = speedCurveGeometry(dropped, config, seed.scale);
    near(after.outSpeedY, 0.4, "handle sits where it was dropped");
    near(after.velocitySamples[0], 0.4, "and the curve starts there too");
}

// --- click-to-match: exact in value-per-frame, not just visually flush -----------

{
    const bounds = { startX: 30, startY: 200, endX: 200, endY: 30 };
    const clamp = (v) => Math.min(0.999, Math.max(0.001, v));
    const realSpeed = (seg, t) =>
        calculateVelocityAtTime(t, clamp(seg.easing.x1), seg.easing.y1, clamp(seg.easing.x2), seg.easing.y2)
        * Math.abs(seg.valueDiff / seg.frameDiff);

    const easing = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    const sel = { frameDiff: 20, valueDiff: 100, easing: easing };
    // Arrives at slope (1 - y2) / (1 - x2) = 1.5, i.e. 7.5 units/frame over this segment.
    const prev = { frameDiff: 20, valueDiff: 100, easing: { x1: 0, y1: 0, x2: 0.6, y2: 0.4 } };

    const cfg = { width: 230, height: 230, padding: 30, neighbours: { sel: sel, prev: prev } };
    const geometry = speedCurveGeometry(easing, cfg);
    const ghost = speedGhostPolyline("prev", sel, prev, bounds, geometry.peak, 24);

    const updated = speedToCubicBezier(
        geometry.outInfluence, geometry.inInfluence, ghost.joinHeight, geometry.inSpeedY, geometry.scale
    );
    const after = { frameDiff: 20, valueDiff: 100, easing: updated };

    near(realSpeed(prev, 1), 7.5, "the neighbour arrives at 7.5 units/frame");
    near(realSpeed(after, 0), realSpeed(prev, 1), "the selection now leaves at exactly that speed");
}

console.log("speedHandles: ok");
