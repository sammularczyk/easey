// Run with: node dev/test/speedCurveGeometry.test.mjs
// Covers speedCurveGeometry, the single source of truth graphRenderer's drawSpeedCurve and
// mouseHandlers' speedHandlePositions/selectedSpeedPeak all read from. It used to be two
// separate copies of this math: drawSpeedCurve computed it and mutated its speedEasing
// argument with the result, and mouseHandlers read those mutated fields back — so hit-testing
// only matched the drawing if a draw had already run. These tests lock in that the function is
// pure (no mutation of its inputs) and that its outputs match hand-computed geometry.

import assert from "node:assert/strict";
import { speedCurveGeometry } from "../src/modules/graphRenderer.js";
import { cubicBezierToSpeed, sampleVelocityCurveWithMax } from "../src/modules/conversions.js";
import { plotBounds } from "../src/modules/geometry.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const config = { width: 230, height: 230, padding: 30 };
const easing = { x1: 0.3, y1: 0.2, x2: 0.6, y2: 0.9 };

// --- purity -------------------------------------------------------------------

const easingCopy = Object.assign({}, easing);
const configCopy = Object.assign({}, config);
speedCurveGeometry(easing, config);
assert.deepEqual(easing, easingCopy, "does not mutate the easing argument");
assert.deepEqual(config, configCopy, "does not mutate the config argument");

// --- derived speed values match conversions.js directly ------------------------

const geometry = speedCurveGeometry(easing, config);
const speed = cubicBezierToSpeed(easing.x1, easing.y1, easing.x2, easing.y2);

assert.equal(geometry.outInfluence, speed.outInfluence, "outInfluence matches cubicBezierToSpeed");
assert.equal(geometry.inInfluence, speed.inInfluence, "inInfluence matches cubicBezierToSpeed");
assert.equal(geometry.outSpeedY, speed.outSpeedY, "outSpeedY matches cubicBezierToSpeed");
assert.equal(geometry.inSpeedY, speed.inSpeedY, "inSpeedY matches cubicBezierToSpeed");

// --- handle positions match the plot bounds by hand -----------------------------

const bounds = plotBounds(config);
const expectedOutX = bounds.startX + (speed.outInfluence / 100) * (bounds.midX - bounds.startX);
const expectedInX = bounds.endX - (speed.inInfluence / 100) * (bounds.endX - bounds.midX);
const expectedOutY = bounds.endY + (speed.outSpeedY * bounds.graphHeight);
const expectedInY = bounds.endY + (speed.inSpeedY * bounds.graphHeight);

near(geometry.outHandleX, expectedOutX, 1e-9, "outHandleX");
near(geometry.inHandleX, expectedInX, 1e-9, "inHandleX");
near(geometry.outHandleY, expectedOutY, 1e-9, "outHandleY");
near(geometry.inHandleY, expectedInY, 1e-9, "inHandleY");

// --- sampled velocity curve --------------------------------------------------

assert.equal(geometry.sampleCount, 50, "sampleCount is the shared magic sample count");
assert.equal(geometry.velocitySamples.length, geometry.sampleCount + 1, "one sample per frame boundary, inclusive");

const expectedSampled = sampleVelocityCurveWithMax(
    Math.min(0.999, Math.max(0.001, easing.x1)),
    easing.y1,
    Math.min(0.999, Math.max(0.001, easing.x2)),
    easing.y2,
    50
);
assert.deepEqual(geometry.velocitySamples, expectedSampled.samples, "velocitySamples matches sampleVelocityCurveWithMax");

// --- peak: no neighbours means no scale to measure against ---------------------

assert.equal(speedCurveGeometry(easing, config).peak, 0, "peak is 0 without config.neighbours");
assert.equal(
    speedCurveGeometry(easing, { width: 230, height: 230, padding: 30, neighbours: {} }).peak,
    0,
    "peak is 0 without a selected segment"
);
assert.equal(
    speedCurveGeometry(easing, {
        width: 230, height: 230, padding: 30,
        neighbours: { sel: { frameDiff: 0, valueDiff: 100 } }
    }).peak,
    0,
    "peak is 0 when the selected segment has no frame span"
);

// --- peak: matches the neighbour-normalised formula by hand ---------------------

const sel = { frameDiff: 20, valueDiff: -50 };
const withNeighbours = speedCurveGeometry(easing, {
    width: 230, height: 230, padding: 30,
    neighbours: { sel: sel }
});
const expectedPeak = expectedSampled.max * Math.abs(sel.valueDiff / sel.frameDiff);
near(withNeighbours.peak, expectedPeak, 1e-9, "peak matches sampledSelection.max * |valueDiff / frameDiff|");

console.log("speedCurveGeometry: ok");
