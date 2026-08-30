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
// outSpeedY/inSpeedY are HEIGHTS on the plot, not raw speeds: the graph normalises to its
// peak so it always fits. cubicBezierToSpeed hands back the real slopes (rise over run at each
// keyframe); dividing by the peak is what puts them on the axis.
const scale = sampleVelocityCurveWithMax(
    Math.min(0.999, Math.max(0.001, easing.x1)),
    easing.y1,
    Math.min(0.999, Math.max(0.001, easing.x2)),
    easing.y2,
    50
).max;
near(geometry.scale, scale, 1e-12, "scale is the curve's own peak by default");
near(geometry.outSpeedY, speed.outSpeed / scale, 1e-12, "outSpeedY is the start speed over the peak");
near(geometry.inSpeedY, speed.inSpeed / scale, 1e-12, "inSpeedY is the end speed over the peak");
near(geometry.outSpeedY, easing.y1 / easing.x1 / scale, 1e-12, "start speed is y1 / x1, not y1");

// The whole point of the normalisation: the curve's ends ARE the handles. drawSpeedCurve used
// to shear the curve to force this; now nothing has to.
near(geometry.velocitySamples[0], geometry.outSpeedY, 1e-12, "first sample sits on the out handle");
near(geometry.velocitySamples[50], geometry.inSpeedY, 1e-12, "last sample sits on the in handle");

// And it fits: peak speed is exactly the top of the plot.
near(Math.max(...geometry.velocitySamples), 1, 1e-12, "the peak fills the plot height exactly");

// --- handle positions match the plot bounds by hand -----------------------------

const bounds = plotBounds(config);
const expectedOutX = bounds.startX + (speed.outInfluence / 100) * (bounds.midX - bounds.startX);
const expectedInX = bounds.endX - (speed.inInfluence / 100) * (bounds.endX - bounds.midX);
const expectedOutY = bounds.endY + (geometry.outSpeedY * bounds.graphHeight);
const expectedInY = bounds.endY + (geometry.inSpeedY * bounds.graphHeight);

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

// --- a frozen scale (a drag in progress) -----------------------------------------

// During a drag the peak is held still, so the handle tracks the pointer instead of sliding
// away as the curve reshapes under it. Everything the graph draws shifts by the same ratio.
{
    const frozen = speedCurveGeometry(easing, config, scale * 2);
    near(frozen.scale, scale * 2, 1e-12, "the override wins over the curve's own peak");
    near(frozen.outSpeedY, geometry.outSpeedY / 2, 1e-12, "handle height halves against a doubled scale");
    near(Math.max(...frozen.velocitySamples), 0.5, 1e-12, "and so does the curve");
    near(frozen.velocitySamples[0], frozen.outSpeedY, 1e-12, "ends still sit on the handles");

    const ignored = speedCurveGeometry(easing, config, 0);
    near(ignored.scale, scale, 1e-12, "a scale of 0 means 'not dragging', not 'divide by zero'");
}

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
