// Run with: node dev/test/pathSolve.test.mjs
// Geometry and fitting for curved motion path easing. The control points and sampled
// positions below are real, captured from a 70-frame segment in Cavalry (group#1, frames
// 27-97) — the scene that exposed the bug this module exists to fix.

import assert from "node:assert/strict";
import {
    pathPoint,
    buildArcTable,
    arcAt,
    arcInverse,
    projectToPath,
    easeAt,
    fitEase,
    sharedTangentOffset
} from "../src/modules/pathSolve.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// The real segment: start, end, and the two handles read off the keyframes' bez data.
const START = [431.896, 326.538];
const END = [358.853, -19.81];
const P = [
    START,
    [START[0] - 3152.928280924479, START[1] - 234.80983836873372],
    [END[0] - 172.23902636718626, END[1] - 431.78079492187186],
    END
];

// --- geometry ---------------------------------------------------------------

assert.deepEqual(pathPoint(P, 0), START, "u=0 is the start keyframe");
assert.deepEqual(pathPoint(P, 1), END, "u=1 is the end keyframe");

const table = buildArcTable(P);
// Cavalry's own per-frame samples over this segment summed to 3012.1 units.
near(table.total, 3012.5, 5, "arc length matches what Cavalry rendered");

near(arcAt(table, 0), 0, 1e-9, "no distance at the start");
near(arcAt(table, 1), 1, 1e-9, "all of it at the end");
for (let u = 0.05; u < 1; u += 0.05) {
    assert.ok(arcAt(table, u) >= arcAt(table, u - 0.05), "arc fraction never goes backwards");
}

// The whole reason this module exists: on this path, distance is nowhere near proportional
// to the bezier parameter. The first quarter of the parameter covers nearly half the length,
// so the layer runs ahead of any timing curve and coasts home — the phantom ease-out.
assert.ok(arcAt(table, 0.25) > 0.4, "geometry front-loads distance");
assert.ok(arcAt(table, 0.5) > 0.55, "still ahead at the halfway parameter");

for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    near(arcAt(table, arcInverse(table, s)), s, 1e-3, `arcInverse round-trips at ${s}`);
}

// --- projection -------------------------------------------------------------

// Real positions Cavalry rendered at frames 27, 62, 96 and 97 of this segment.
const samples = [
    [431.896, 326.538],
    [-1028.581, 23.319],
    [-348.43, -177.416],
    [358.853, -19.81]
];
for (const point of samples) {
    const u = projectToPath(P, point);
    const q = pathPoint(P, u);
    near(Math.hypot(q[0] - point[0], q[1] - point[1]), 0, 0.5, "rendered position lies on the path");
}
near(projectToPath(P, START), 0, 1e-3, "start projects to u=0");
near(projectToPath(P, END), 1, 1e-3, "end projects to u=1");

// --- easing -----------------------------------------------------------------

near(easeAt(0, 0.25, 0.1, 0.25, 1), 0, 1e-9, "easing pinned at 0");
near(easeAt(1, 0.25, 0.1, 0.25, 1), 1, 1e-9, "easing pinned at 1");
near(easeAt(0.5, 0, 0, 1, 1), 0.5, 1e-6, "the identity curve is linear");
// cubic-bezier(0.458, 0.146, 0.991, 0.472) holds back hard, then rushes the last tenth.
assert.ok(easeAt(0.9, 0.458, 0.146, 0.991, 0.472) < 0.7, "reported curve is still low at t=0.9");

// --- fitting ----------------------------------------------------------------

// A curve fitted to its own samples must come back as itself.
const times = Array.from({ length: 12 }, (_, i) => (i + 1) / 13);
const selfSamples = times.map((t) => easeAt(t, 0.3, 0.05, 0.7, 0.95));
const selfFit = fitEase(times, selfSamples, 1 / 70);
assert.ok(selfFit.rms < 5e-3, `recovers a known curve (rms ${selfFit.rms})`);

// The fit must never propose a ramp narrower than the frame floor it is given.
const steep = times.map((t) => easeAt(t, 0.9, 0.0, 0.999, 0.05));
const bounded = fitEase(times, steep, 1 / 70);
assert.ok(bounded.x1 >= 1 / 70 - 1e-9, "x1 respects the influence floor");
assert.ok(1 - bounded.x2 >= 1 / 70 - 1e-9, "x2 respects the influence floor");

// The load-bearing case: pre-warping the request by the path's own distance distribution
// must be expressible as a cubic-bezier, or the solver has nothing to aim at.
const wanted = times.map((t) => easeAt(t, 0.458, 0.146, 0.991, 0.472));
const warped = wanted.map((s) => arcInverse(table, s));
const warpFit = fitEase(times, warped, 1 / 70);
assert.ok(warpFit.rms < 0.05, `pre-warped target is reachable (rms ${warpFit.rms})`);

// And the pre-warp has to actually undo the geometry, not just fit something.
for (let i = 0; i < times.length; i++) {
    near(arcAt(table, warped[i]), wanted[i], 1e-3, "pre-warp cancels the distance distribution");
}

// --- tangent desync repair ---------------------------------------------------

// Healthy handles agree and sit inside the segment, so nothing is rewritten.
assert.equal(sharedTangentOffset(12, 12, 40), null, "matched handles need no repair");
assert.equal(sharedTangentOffset(-12, -12, 40), null, "matched incoming handles too");
assert.equal(sharedTangentOffset(0, 0, 40), null, "two flat handles are a linear segment");

// Captured from the reproduction: deleting a keyframe leaves the channels 1.2 frames apart.
near(sharedTangentOffset(43.877, 42.683, 80), 42.683, 1e-9, "takes the shorter outgoing handle");
near(sharedTangentOffset(-30.069, -30.773, 80), -30.069, 1e-9, "takes the shorter incoming handle");

// The scene that prompted this: 86-frame segment, one channel reaching 129.851 frames back.
// Repairing to -2.248 is what put the rendered path back on its handles, 190 units -> 0.35.
near(sharedTangentOffset(-2.2480938604566774, -129.85134390272137, 86), -2.2480938604566774, 1e-9,
    "the folded channel loses to the sane one");

// Agreeing on a value that still overshoots the segment folds both channels, so clamp.
near(sharedTangentOffset(-120, -120, 86), -86, 1e-9, "matched but overlong is still clamped");
near(sharedTangentOffset(200, 150, 86), 86, 1e-9, "clamps to the segment, keeping the sign");

// One flat channel against one with length is damage, not a linear segment — keep the length.
near(sharedTangentOffset(0, -30, 80), -30, 1e-9, "falls back to the channel that has length");
near(sharedTangentOffset(25, 0, 80), 25, 1e-9, "either side may be the flat one");

// Never returns something that would fold a channel or point the wrong way.
for (const [a, b, fd] of [[43.877, 42.683, 80], [-30.069, -30.773, 80], [200, 150, 86], [-2.25, -129.85, 86]]) {
    const shared = sharedTangentOffset(a, b, fd);
    assert.ok(Math.abs(shared) <= fd + 1e-9, "repair never reaches outside the segment");
    assert.ok(Math.sign(shared) === Math.sign(a) || Math.sign(shared) === Math.sign(b), "keeps a real direction");
}

// Garbage in, no rewrite — better to leave a keyframe alone than to guess at it.
assert.equal(sharedTangentOffset(NaN, 12, 40), null, "ignores NaN");
assert.equal(sharedTangentOffset(12, Infinity, 40), null, "ignores Infinity");
assert.equal(sharedTangentOffset(12, 12, 0), null, "ignores a zero-length segment");

console.log("pathSolve: ok");
