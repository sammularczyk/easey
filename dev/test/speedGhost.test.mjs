// Run with: node dev/test/speedGhost.test.mjs
// Covers speedGhostPolyline, the geometry shared by graphRenderer (drawing neighbour "ghost"
// curves) and mouseHandlers (hit-testing clicks against those same ghosts). It is the only
// place either module builds these points, so a silent change here desyncs what the user
// sees from what they can click. These tests lock in the CURRENT behaviour, including a
// couple of edge cases that look surprising but are what the code actually does today.

import assert from "node:assert/strict";
import {
    speedGhostPolyline,
    sampleVelocityCurveWithMax
} from "../src/modules/conversions.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// The plot rect drawCurve builds from GRAPH_CONFIG {width:230, height:230, padding:30}.
// ui.Draw is y-up, so endY is the bottom edge and startY the top (see neighbours.test.mjs).
const bounds = { startX: 30, startY: 200, endX: 200, endY: 30 };
const graphHeight = bounds.startY - bounds.endY; // 170

const sel = { frameDiff: 20, valueDiff: 100 };
const linear = { x1: 0, y1: 0, x2: 1, y2: 1 };

// A neighbour with the identical shape and rate as the selection: its own peak, expressed in
// real value/frame, equals selPeak exactly, so segScale collapses to 1 and the ghost's y
// range should land exactly on the plot's own [endY, startY] span with no clipping.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: linear };
    const sampled = sampleVelocityCurveWithMax(0.001, 0, 0.999, 1, 24);
    const selPeak = sampled.max * Math.abs(seg.valueDiff / seg.frameDiff);

    const ghost = speedGhostPolyline("next", sel, seg, bounds, selPeak, 24);
    assert.equal(ghost.points.length, 25, "sampleCount 24 gives 25 points (0..count inclusive)");

    for (const [x, y] of ghost.points) {
        assert.ok(x >= bounds.endX, `next ghost x stays right of the plot: x=${x}`);
        assert.ok(y >= bounds.endY - 1e-6 && y <= bounds.startY + 1e-6,
            `identical-rate ghost y stays within plot bounds: y=${y}`);
    }
    near(ghost.points[0][0], bounds.endX, "next ghost starts at the plot's right edge");

    // Same segment mirrored to the "prev" side: x must run left of the plot, and the shared
    // corner (the neighbour's END) is the LAST sample, per the joinIndex comment in the source.
    const prevGhost = speedGhostPolyline("prev", sel, seg, bounds, selPeak, 24);
    for (const [x] of prevGhost.points) {
        assert.ok(x <= bounds.startX, `prev ghost x stays left of the plot: x=${x}`);
    }
    near(prevGhost.joinHeight, sampled.samples[24], "prev joinHeight reads the LAST sample (the shared corner)");
    near(ghost.joinHeight, sampled.samples[0], "next joinHeight reads the FIRST sample (the shared corner)");
}

// spanX: the neighbour's own frameDiff maps through the SELECTED segment's px-per-frame, so a
// neighbour twice as long in frames spans twice the plot's width, unclamped.
{
    const seg = { frameDiff: 40, valueDiff: 100, easing: linear };
    const sampled = sampleVelocityCurveWithMax(0.001, 0, 0.999, 1, 24);
    const selPeak = sampled.max * Math.abs(100 / 40);
    const pxPerFrame = (bounds.endX - bounds.startX) / sel.frameDiff; // 8.5 px/frame
    const ghost = speedGhostPolyline("next", sel, seg, bounds, selPeak, 24);
    const spanX = 40 * pxPerFrame;
    near(ghost.points[ghost.points.length - 1][0], bounds.endX + spanX, "spanX scales with the neighbour's own frameDiff");
}

// The honest-overflow case from the docstring: a neighbour genuinely FASTER than the
// selection (selPeak deliberately set below the neighbour's real peak) must run off the top
// rather than get clamped into the plot. That's segScale > 1, uncapped.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: linear };
    const sampled = sampleVelocityCurveWithMax(0.001, 0, 0.999, 1, 24);
    const realPeak = sampled.max * Math.abs(seg.valueDiff / seg.frameDiff);
    const selPeak = realPeak / 2; // selection is half as fast as this neighbour

    const ghost = speedGhostPolyline("next", sel, seg, bounds, selPeak, 24);
    const maxY = Math.max(...ghost.points.map((p) => p[1]));
    assert.ok(maxY > bounds.startY + 1e-6, `a faster neighbour overflows the plot's y edge uncapped: maxY=${maxY}, startY=${bounds.startY}`);
    near(maxY, bounds.endY + graphHeight * 2, "overflow is exactly proportional to how much faster the neighbour is (2x here)");
}

// sampleCount is floored at 2 even when passed 0/negative/undefined, and falls back to 24
// specifically when falsy (0 included) rather than to the floor of 2 — `sampleCount || 24`.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: linear };
    const sampled = sampleVelocityCurveWithMax(0.001, 0, 0.999, 1, 24);
    const selPeak = sampled.max * Math.abs(100 / 20);

    const zero = speedGhostPolyline("next", sel, seg, bounds, selPeak, 0);
    assert.equal(zero.points.length, 25, "sampleCount 0 is falsy, so it falls back to the 24-sample default, not the 2-sample floor");

    const negative = speedGhostPolyline("next", sel, seg, bounds, selPeak, -5);
    assert.equal(negative.points.length, 3, "a negative sampleCount is truthy, so Math.max(2, -5) floors it to 2 (3 points)");

    const undef = speedGhostPolyline("next", sel, seg, bounds, selPeak, undefined);
    assert.equal(undef.points.length, 25, "sampleCount omitted defaults to 24 samples");
}

// Easing x1/x2 are clamped into [0.001, 0.999] before sampling, so a flat handle at the exact
// boundary (x1=0 or x2=1) does not divide by zero in the velocity calc — it is nudged inside
// first. Locking in that the clamped call is what actually runs.
{
    const boundaryEasing = { x1: 0, y1: 0.2, x2: 1, y2: 0.8 };
    const seg = { frameDiff: 20, valueDiff: 100, easing: boundaryEasing };
    const selPeak = 1; // arbitrary; only checking it doesn't throw / produces finite output
    const ghost = speedGhostPolyline("next", sel, seg, bounds, selPeak, 10);
    assert.equal(ghost.points.length, 11, "boundary easing still returns the requested sample count");
    for (const [x, y] of ghost.points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `boundary easing x1=0/x2=1 produces finite points: (${x}, ${y})`);
    }
    // Confirm it matches sampling with the clamped values directly, i.e. the function really
    // does clamp rather than pass 0/1 straight through to calculateVelocityAtTime.
    const clampedSampled = sampleVelocityCurveWithMax(0.001, 0.2, 0.999, 0.8, 10);
    const segScale = clampedSampled.max * Math.abs(seg.valueDiff / seg.frameDiff) / selPeak;
    for (let i = 0; i <= 10; i++) {
        near(ghost.points[i][1], bounds.endY + clampedSampled.samples[i] * segScale * graphHeight,
            `point ${i} matches sampling with x1/x2 clamped to 0.001/0.999`);
    }
}

// Degenerate / unmappable inputs return null rather than NaN or a division by zero.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: linear };
    assert.equal(speedGhostPolyline("next", null, seg, bounds, 1, 24), null, "missing selection");
    assert.equal(speedGhostPolyline("next", sel, null, bounds, 1, 24), null, "missing neighbour");
    assert.equal(speedGhostPolyline("next", sel, { frameDiff: 20, valueDiff: 100 }, bounds, 1, 24), null, "neighbour with no easing");
    assert.equal(speedGhostPolyline("next", sel, seg, bounds, 0, 24), null, "selPeak of 0 (a hold selection) is refused, not divided by");
    assert.equal(speedGhostPolyline("next", sel, seg, bounds, -1, 24), null, "negative selPeak is refused too");
    assert.equal(speedGhostPolyline("next", { frameDiff: 0, valueDiff: 100 }, seg, bounds, 1, 24), null, "zero-length selection");
    assert.equal(speedGhostPolyline("next", sel, { frameDiff: 0, valueDiff: 100, easing: linear }, bounds, 1, 24), null, "zero-length neighbour");
}

console.log("speedGhost.test.mjs: ok");
