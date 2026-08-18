// Run with: node dev/test/velocityFit.test.mjs
// Covers the Get -> Apply round trip for velocity-eased motion path segments.
//
// Get reads these segments by fitting the motion Cavalry renders, because converting their
// speed and influence reports a curve the layer is not following (measured: 14px off on a
// 600px move at Cavalry's own defaults, 79px at livelier settings). That makes the reverse
// conversion lossy too, so applying an untouched curve would nudge a segment the user never
// edited. velocityFitIsUnedited is the guard that stops it.

import assert from "node:assert/strict";
import { velocityFitIsUnedited } from "../src/modules/keyframeOps.js";

const easing = { x1: 0.10312, y1: 0.02034, x2: 0.90217, y2: 0.98533 };
const velocity = { rightSpeed: 1, rightInfluence: 0.333, leftSpeed: 1, leftInfluence: 0.333 };
const entry = { easing, velocity };

const live0 = () => ({ rightSpeed: 1, rightInfluence: 0.333, leftSpeed: 0, leftInfluence: 0.5 });
const live1 = () => ({ rightSpeed: 0, rightInfluence: 0.5, leftSpeed: 1, leftInfluence: 0.333 });

// Untouched: same curve, keyframes unchanged. Leave the segment exactly as found.
assert.equal(
    velocityFitIsUnedited(entry, { ...easing }, live0(), live1()),
    true,
    "an unedited segment is left alone"
);

// Any edit at all must fall through to a normal conversion. A drag moves a control point by
// far more than this, so if the smallest possible nudge is not caught, nothing is.
for (const key of ["x1", "y1", "x2", "y2"]) {
    const edited = { ...easing, [key]: easing[key] + 1e-9 };
    assert.equal(
        velocityFitIsUnedited(entry, edited, live0(), live1()),
        false,
        `a nudge to ${key} counts as an edit`
    );
}

// The displayed value is rounded to 3 decimals. If the user retypes what they see, that is a
// different number from the fit and must NOT be mistaken for "untouched" — otherwise Easey
// would silently ignore a value they deliberately entered.
const retyped = { x1: 0.103, y1: 0.02, x2: 0.902, y2: 0.985 };
assert.equal(
    velocityFitIsUnedited(entry, retyped, live0(), live1()),
    false,
    "a value retyped at display precision is treated as an edit"
);

// The scene can move under a cached fit — edited in Cavalry's graph editor, undone, rebuilt.
// Restoring stale velocity then would resurrect timing the keyframes no longer have.
const movedStart = { ...live0(), rightSpeed: 1.5 };
assert.equal(
    velocityFitIsUnedited(entry, { ...easing }, movedStart, live1()),
    false,
    "a start keyframe changed underneath the fit is not restored"
);
const movedEnd = { ...live1(), leftInfluence: 0.4 };
assert.equal(
    velocityFitIsUnedited(entry, { ...easing }, live0(), movedEnd),
    false,
    "an end keyframe changed underneath the fit is not restored"
);

// Only the halves facing this segment matter. The start key's INCOMING side and the end key's
// OUTGOING side belong to the neighbouring segments, so changing them must not block a
// restore — otherwise easing an adjacent segment would drift this one.
const neighbourTouched0 = { ...live0(), leftSpeed: 99, leftInfluence: 0.01 };
const neighbourTouched1 = { ...live1(), rightSpeed: 99, rightInfluence: 0.01 };
assert.equal(
    velocityFitIsUnedited(entry, { ...easing }, neighbourTouched0, neighbourTouched1),
    true,
    "changes on the neighbours' sides do not block the restore"
);

// Missing or malformed inputs must decline rather than throw — a failed fit stores nothing.
assert.equal(velocityFitIsUnedited(null, { ...easing }, live0(), live1()), false, "no cached fit");
assert.equal(velocityFitIsUnedited({}, { ...easing }, live0(), live1()), false, "empty entry");
assert.equal(velocityFitIsUnedited(entry, { ...easing }, undefined, live1()), false, "missing start velocity");
assert.equal(velocityFitIsUnedited(entry, null, live0(), live1()), false, "missing easing");

console.log("velocityFit: ok");

// --- sameSegmentVelocity: the guard behind BOTH round-trip directions ---
// Get -> Apply restores the original velocity when the curve is untouched; Apply -> Get hands
// back the authored curve when the velocity is untouched. Both hinge on this comparison, so
// it has to be exact about the halves that matter and blind to the halves that don't.

const { sameSegmentVelocity } = await import("../src/modules/keyframeOps.js");

const v = () => ({ rightSpeed: 2.5, rightInfluence: 0.35, leftSpeed: 0, leftInfluence: 0.6 });

assert.equal(sameSegmentVelocity(v(), v()), true, "identical velocity matches");

for (const key of ["rightSpeed", "rightInfluence", "leftSpeed", "leftInfluence"]) {
    const changed = { ...v(), [key]: v()[key] + 1e-9 };
    assert.equal(
        sameSegmentVelocity(v(), changed),
        false,
        `a nudge to ${key} breaks the match`
    );
}

// Extra keys are the neighbours' halves — they must not participate.
assert.equal(
    sameSegmentVelocity(v(), { ...v(), leftSpeedOfNeighbour: 99 }),
    true,
    "unrelated fields are ignored"
);

assert.equal(sameSegmentVelocity(null, v()), false, "null declines");
assert.equal(sameSegmentVelocity(v(), undefined), false, "undefined declines");

console.log("sameSegmentVelocity: ok");
