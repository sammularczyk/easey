// Run with: node dev/test/speedTimeAxis.test.mjs
// The speed graph's x axis is TIME. Samples are taken at the bezier's parameter t, which is
// not time — x(t) is. Plotting sample i at i/sampleCount smears the curve horizontally
// wherever the easing is steep, putting the peak in the wrong place. These lock the mapping.

import assert from "node:assert/strict";
import {
    bezierX,
    sampleVelocityCurveWithMax,
    speedGhostPolyline
} from "../src/modules/conversions.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// Endpoints are pinned, and a symmetric easing stays symmetric.
near(bezierX(0, 0.42, 0.58), 0, "x(0) = 0");
near(bezierX(1, 0.42, 0.58), 1, "x(1) = 1");
near(bezierX(0.5, 0.42, 0.58), 0.5, "a symmetric easing has x(0.5) = 0.5");

// x(t) === t only for the linear timing x1 = 1/3, x2 = 2/3; anything else bends.
near(bezierX(0.25, 1 / 3, 2 / 3), 0.25, "linear timing leaves the axis unbent");
assert.ok(bezierX(0.25, 0.19, 0.22) < 0.25, "handles pulled toward the start hold time back early on");

// The sampler reports those times alongside the speeds, and they run 0..1 monotonically.
const s = sampleVelocityCurveWithMax(0.19, 1, 0.22, 1, 50);
assert.equal(s.times.length, s.samples.length, "one time per speed sample");
near(s.times[0], 0, "first sample sits at t = 0");
near(s.times[50], 1, "last sample sits at t = 1");
for (let i = 1; i <= 50; i++) {
    assert.ok(s.times[i] > s.times[i - 1], `time never runs backwards (i=${i})`);
}

// Ease Out Expo: the parameter-space peak is at t = 0 anyway, but the MIDPOINT of the
// parameter range is nowhere near the midpoint of time — the old axis was out by ~0.23.
assert.ok(Math.abs(s.times[25] - 0.5) > 0.2, "parameter midpoint is far from the time midpoint");

// Ghosts use the same mapping, so the drawn line and the hit-test agree with the selection.
{
    const bounds = { startX: 30, startY: 200, endX: 200, endY: 30 };
    const sel = { frameDiff: 20, valueDiff: 100 };
    const seg = { frameDiff: 20, valueDiff: 100, easing: { x1: 0.19, y1: 1, x2: 0.22, y2: 1 } };
    const sampled = sampleVelocityCurveWithMax(0.19, 1, 0.22, 1, 24);
    const selPeak = sampled.max * 5;
    const ghost = speedGhostPolyline("next", sel, seg, bounds, selPeak, 24);
    const spanX = bounds.endX - bounds.startX; // same frameDiff as the selection

    near(ghost.points[0][0], bounds.endX, "ghost still starts at the shared keyframe");
    near(ghost.points[24][0], bounds.endX + spanX, "and still ends a full segment later");
    for (let i = 0; i <= 24; i++) {
        near(ghost.points[i][0], bounds.endX + sampled.times[i] * spanX,
            `ghost point ${i} sits at its real time`);
    }
}

console.log("speedTimeAxis: ok");
