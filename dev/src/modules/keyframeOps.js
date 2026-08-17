// Keyframe operations module
// Functions for extracting and applying easing to keyframes

import { cubicBezierToCavalry, cavalryToCubicBezier, cubicBezierToVelocity, velocityToCubicBezier, getCompositionFrameRate, framesToMilliseconds } from './conversions.js';
import { buildArcTable, arcAt, arcInverse, projectToPath, easeAt, fitEase, sharedTangentOffset } from './pathSolve.js';

var DEFAULT_LEFT_SPEED = 0.0;
var DEFAULT_LEFT_INFLUENCE = 0.333;
var DEFAULT_RIGHT_SPEED = 1.0;
var DEFAULT_RIGHT_INFLUENCE = 0.333;
var IDENTICAL_VALUE_EPSILON = 0.001;

var _clampHoldsEnabled = true;

// Measured: 10 is the floor. Accuracy is flat from 60 samples down to 10 (a 600px move fits
// to within 0.6px either way) and falls off a cliff at 8. Scrubbing is nearly free — 61
// samples cost 0.35ms — so the whole budget goes on fitEase, which runs ~16ms at this count
// against ~120ms at 60.
var VELOCITY_FIT_SAMPLES = 10;

// Fits from the last read, keyed by segment, each holding the curve that was fitted and the
// speed/influence it was fitted from. Lets Apply put a segment back exactly as found when the
// user never touched its curve — see restoreUneditedVelocity.
var _velocityFits = {};
// Ghost curves re-read on every selection change, so entries would otherwise pile up all
// session. Nothing needs to survive beyond a Get followed by an Apply.
var VELOCITY_FIT_CACHE_MAX = 64;

/**
 * Set whether identical-value clamping is active (called from Easey.js when preference changes).
 */
export function setClampHoldsEnabled(enabled) {
    _clampHoldsEnabled = enabled;
}

function valuesAreIdentical(a, b) {
    return Math.abs(a - b) < IDENTICAL_VALUE_EPSILON;
}

/**
 * Frame times on the sibling position axis (for motion path detection).
 * @param {string} layerId
 * @param {string} attrId
 * @returns {Set<number>|null} null if not position.x / position.y
 */
function getSiblingKeyframeTimesSet(layerId, attrId) {
    if (attrId !== 'position.x' && attrId !== 'position.y') {
        return null;
    }
    var siblingAttr = attrId === 'position.x' ? 'position.y' : 'position.x';
    try {
        var times = api.getKeyframeTimes(layerId, siblingAttr);
        if (!times || !Array.isArray(times)) {
            return new Set();
        }
        return new Set(times);
    } catch (e) {
        return new Set();
    }
}

/**
 * True when Cavalry evaluates this segment from speed + influence rather than from the
 * bezier handles. Handles are only honoured while both bounding speeds are 1; attributes
 * with no speed data at all (everything that isn't a motion path) are always handle-driven.
 *
 * Deliberately does NOT check whether this is still a motion path. Speed fields outlive the
 * path that created them — delete one position channel and the survivor keeps them — and the
 * obvious repair is to gate on the sibling axis and fall back to the handles. Measured, that
 * is wrong: Cavalry renders from the speed fields whenever they are present, sibling channel
 * or not. A probe layer with only position.x keyed reproduced a real orphaned segment's
 * motion to four decimal places from speed + influence, while the same handles alone gave a
 * visibly different curve. So presence of the fields IS the correct test, and the sibling
 * check belongs only in the write path, where it decides what kind of easing to author.
 *
 * @param {Object} frameZeroData - key data at the start of the segment
 * @param {Object} frameEndData - key data at the end of the segment
 */
function segmentUsesVelocity(frameZeroData, frameEndData) {
    var outSpeed = frameZeroData ? frameZeroData.rightSpeed : null;
    var inSpeed = frameEndData ? frameEndData.leftSpeed : null;
    if (outSpeed === undefined || outSpeed === null || inSpeed === undefined || inSpeed === null) {
        return false;
    }
    return Math.abs(outSpeed - TANGENT_MODE_SPEED) > TANGENT_SPEED_EPSILON ||
        Math.abs(inSpeed - TANGENT_MODE_SPEED) > TANGENT_SPEED_EPSILON;
}

/**
 * Keyframe ids for the given frames, in frame order.
 * api.getSelectedKeyframeIds() returns ids in selection order, which is not frame order —
 * pairing those with a sorted frame list silently processes segments backwards.
 * @param {string} layerId
 * @param {string} attrId
 * @param {number[]} frames - sorted frames
 * @returns {string[]} ids aligned to frames (missing frames yield null)
 */
function keyframeIdsForFrames(layerId, attrId, frames) {
    var times = [];
    var ids = [];
    try {
        times = api.getKeyframeTimes(layerId, attrId) || [];
        ids = api.getKeyframeIdsForAttribute(layerId, attrId) || [];
    } catch (e) {
        return frames.map(function () { return null; });
    }
    return frames.map(function (frame) {
        var index = times.indexOf(frame);
        return index === -1 ? null : ids[index];
    });
}

/**
 * True if both endpoints have keyframes on the sibling position channel (motion path segment).
 * @param {Set<number>|null} siblingTimesSet
 * @param {number} frameA
 * @param {number} frameB
 */
function isMotionPathPair(siblingTimesSet, frameA, frameB) {
    if (!siblingTimesSet || siblingTimesSet.size === 0) {
        return false;
    }
    return siblingTimesSet.has(frameA) && siblingTimesSet.has(frameB);
}

/**
 * Contiguous runs of keyframe indices where each consecutive pair is a motion path pair.
 * @param {{ frames: number[] }} group
 * @param {Set<number>} siblingTimesSet
 * @returns {{ start: number, end: number }[]}
 */
function findMotionPathRuns(group, siblingTimesSet) {
    var runs = [];
    var runStart = null;
    var n = group.frames.length;
    for (var k = 0; k < n - 1; k++) {
        var isPath = isMotionPathPair(siblingTimesSet, group.frames[k], group.frames[k + 1]);
        if (isPath) {
            if (runStart === null) {
                runStart = k;
            }
        } else {
            if (runStart !== null) {
                runs.push({ start: runStart, end: k });
                runStart = null;
            }
        }
    }
    if (runStart !== null) {
        runs.push({ start: runStart, end: n - 1 });
    }
    return runs;
}

/**
 * Unlock two keyframes for tangent editing (interpolation + handles + modifyKeyframeTangent).
 */
function unlockKeyframePair(keyframeIdA, keyframeIdB, frameA, frameB, attrId, layerId) {
    var items = [
        { id: keyframeIdA, frame: frameA },
        { id: keyframeIdB, frame: frameB }
    ];
    for (var p = 0; p < items.length; p++) {
        var keyframeId = items[p].id;
        var frame = items[p].frame;
        try {
            var keyData = api.get(keyframeId, 'data');
            if (keyData && keyData.interpolation !== 0) {
                api.modifyKeyframe(keyframeId, 'interpolation', 0);
                keyData = api.get(keyframeId, 'data');
            }
            if (keyData) {
                if (!keyData.leftBez) {
                    try {
                        api.modifyKeyframe(keyframeId, 'leftBez.x', 0);
                        api.modifyKeyframe(keyframeId, 'leftBez.y', 0);
                    } catch (e) {}
                }
                if (!keyData.rightBez) {
                    try {
                        api.modifyKeyframe(keyframeId, 'rightBez.x', 0);
                        api.modifyKeyframe(keyframeId, 'rightBez.y', 0);
                    } catch (e) {}
                }
            }
            try {
                var unlockObj = {};
                unlockObj[attrId] = {
                    frame: frame,
                    inHandle: true,
                    outHandle: true,
                    angleLocked: false,
                    weightLocked: false
                };
                api.modifyKeyframeTangent(layerId, unlockObj);
            } catch (e) {}
        } catch (e) {}
    }
}

var TANGENT_MODE_SPEED = 1.0;
var TANGENT_SPEED_EPSILON = 0.0001;
var STRAIGHT_PATH_TOLERANCE_FRACTION = 0.01;    // 1% of the segment's chord length
var STRAIGHT_PATH_TOLERANCE_MIN = 0.5;          // units, floor for very short moves
var STRAIGHT_PATH_SAMPLES = 9;

/**
 * True when a motion path segment is straight enough to treat as a straight line, so tangent
 * easing can be used instead of velocity easing. Measures the actual path: the largest
 * perpendicular distance from the chord, sampled across the segment. A visually straight
 * segment with slightly nudged handles passes, and applying tangent easing then straightens
 * it exactly — which is the point, it matches a single-value Attribute's easing precisely.
 */
function segmentPathIsStraight(layerId, frameA, frameB, valueAX, valueBX, valueAY, valueBY) {
    var chordX = valueBX - valueAX;
    var chordY = valueBY - valueAY;
    var chord = Math.hypot(chordX, chordY);
    if (chord < IDENTICAL_VALUE_EPSILON) {
        return true;
    }
    var tolerance = Math.max(STRAIGHT_PATH_TOLERANCE_MIN, chord * STRAIGHT_PATH_TOLERANCE_FRACTION);
    var frameDiff = frameB - frameA;
    var steps = Math.min(STRAIGHT_PATH_SAMPLES, Math.max(0, frameDiff - 1));
    for (var s = 1; s <= steps; s++) {
        api.setFrame(frameA + Math.round((frameDiff * s) / (steps + 1)));
        var offsetX = api.get(layerId, 'position.x') - valueAX;
        var offsetY = api.get(layerId, 'position.y') - valueAY;
        if (Math.abs(offsetX * chordY - offsetY * chordX) / chord > tolerance) {
            return false;
        }
    }
    return true;
}

/**
 * Write tangent-based easing to both axes of one straight motion path segment.
 * Cavalry only honours bezier handles on a position keyframe when that side's speed is 1
 * and no magic easing is set — the caller must set both speeds, this clears magic easing.
 */
function applyTangentEasingToPathSegment(layerId, frameA, frameB, valueAX, valueBX, valueAY, valueBY, currentEasing) {
    var frameDiff = frameB - frameA;
    var axes = [
        { attrId: 'position.x', valueA: valueAX, valueB: valueBX },
        { attrId: 'position.y', valueA: valueAY, valueB: valueBY }
    ];
    axes.forEach(function (axis) {
        [frameA, frameB].forEach(function (frame) {
            try {
                api.magicEasing(layerId, axis.attrId, frame, 'None');
            } catch (e) {}
        });
        var handles = cubicBezierToCavalry(
            currentEasing.x1,
            currentEasing.y1,
            currentEasing.x2,
            currentEasing.y2,
            frameDiff,
            axis.valueB - axis.valueA
        );
        try {
            var outObj = {};
            outObj[axis.attrId] = {
                frame: frameA,
                outHandle: true,
                xValue: frameA + handles.outHandleX,
                yValue: axis.valueA + handles.outHandleY,
                angleLocked: false,
                weightLocked: false
            };
            api.modifyKeyframeTangent(layerId, outObj);
            var inObj = {};
            inObj[axis.attrId] = {
                frame: frameB,
                inHandle: true,
                xValue: frameB + handles.inHandleX,
                yValue: axis.valueB + handles.inHandleY,
                angleLocked: false,
                weightLocked: false
            };
            api.modifyKeyframeTangent(layerId, inObj);
        } catch (e) {
            console.log('Error applying tangent easing to path segment at frame ' + frameA + ':', e.message);
        }
    });
}

var SOLVE_SAMPLES = 12;         // frames probed per solver pass, spread across the segment
// Pre-distortion rounds. Measured on a hard case (a 3000-unit S-curve eased with
// cubic-bezier(0.458, 0.146, 0.991, 0.472)): rms 0.116 → 0.033 by pass 4, then a bounce as
// the fit hits the influence ceiling, then down to 0.012 by pass 10. Ten passes is ~120
// setFrame calls per segment, which is imperceptible; stopping at four leaves it 3x worse.
var SOLVE_PASSES = 10;
var SOLVE_TOLERANCE = 0.01;     // rms distance error, as a fraction of the segment's length

/**
 * The segment's spatial cubic, in world XY. Cavalry keeps the motion path's shape in the
 * keyframes' bezier handles: the handle's y component on position.x is the handle's X offset
 * in the scene, and likewise for position.y. Returns null when either keyframe is missing
 * data, which puts the caller back on the direct conversion.
 */
function motionPathControlPoints(layerId, frameA, frameB, startX, startY, endX, endY) {
    function handles(frame) {
        var out = {};
        var axes = ['position.x', 'position.y'];
        for (var a = 0; a < axes.length; a++) {
            var times = api.getKeyframeTimes(layerId, axes[a]);
            var ids = api.getKeyframeIdsForAttribute(layerId, axes[a]);
            var index = times.indexOf(frame);
            if (index === -1 || !ids[index]) {
                return null;
            }
            var data = api.get(ids[index], 'data');
            if (!data) {
                return null;
            }
            out[axes[a]] = data;
        }
        return out;
    }

    try {
        var a = handles(frameA);
        var b = handles(frameB);
        if (!a || !b) {
            return null;
        }
        var outX = a['position.x'].rightBez, outY = a['position.y'].rightBez;
        var inX = b['position.x'].leftBez, inY = b['position.y'].leftBez;
        if (!outX || !outY || !inX || !inY) {
            return null;
        }
        return [
            [startX, startY],
            [startX + outX.y, startY + outY.y],
            [endX + inX.y, endY + inY.y],
            [endX, endY]
        ];
    } catch (e) {
        return null;
    }
}

/**
 * Find the speed/influence that makes a curved motion path segment travel its DISTANCE on the
 * requested easing curve, rather than its bezier parameter.
 *
 * Two distortions sit between what we ask for and what renders. The path's own geometry
 * redistributes distance across the parameter, and Cavalry's speed/influence does not map onto
 * a cubic-bezier the way the direct conversion assumes. Rather than model either, ask, measure
 * what actually rendered, and push the request further by whatever it fell short — three or
 * four rounds of that converges, and it stays correct if Cavalry's internals change.
 *
 * Returns the residual rms as a fraction of the segment's length, or null if it could not run.
 */
function solveMotionPathSegment(layerId, frameA, frameB, startX, startY, endX, endY, currentEasing, velocityByFrame) {
    var points = motionPathControlPoints(layerId, frameA, frameB, startX, startY, endX, endY);
    if (!points) {
        return null;
    }
    var table = buildArcTable(points);
    if (!(table.total > 0)) {
        return null;
    }

    var frameDiff = frameB - frameA;
    var minInfluence = Math.max(0.01, 1 / frameDiff);
    var sampleCount = Math.min(SOLVE_SAMPLES, Math.max(2, frameDiff - 1));

    // Probe frames strictly inside the segment. The endpoints carry no information — every
    // candidate hits them exactly — and including them flatters the error.
    var times = [];
    var probeFrames = [];
    for (var s = 1; s <= sampleCount; s++) {
        var frame = frameA + Math.round((frameDiff * s) / (sampleCount + 1));
        probeFrames.push(frame);
        times.push((frame - frameA) / frameDiff);
    }

    // What the user asked for, as a fraction of the distance travelled.
    var wanted = times.map(function (t) {
        return easeAt(t, currentEasing.x1, currentEasing.y1, currentEasing.x2, currentEasing.y2);
    });

    var ask = wanted.slice();
    var best = null;
    var seed = null;

    for (var pass = 0; pass < SOLVE_PASSES; pass++) {
        // Convert the distance we want into the path parameter that reaches it, then find the
        // easing curve that follows those parameters.
        var wantParam = ask.map(function (fraction) {
            return arcInverse(table, Math.max(0, Math.min(1, fraction)));
        });
        var fitted = fitEase(times, wantParam, minInfluence, seed);
        seed = fitted;

        var candidate = {
            rightInfluence: Math.max(minInfluence, Math.min(1, fitted.x1)),
            leftInfluence: Math.max(minInfluence, Math.min(1, 1 - fitted.x2))
        };
        candidate.rightSpeed = Math.max(0, fitted.y1 / candidate.rightInfluence);
        candidate.leftSpeed = Math.max(0, (1 - fitted.y2) / candidate.leftInfluence);

        writeSegmentVelocity(layerId, frameA, frameB, candidate, velocityByFrame);

        // Measure what actually rendered, projecting each sampled position back onto the path.
        var achieved = [];
        for (var i = 0; i < probeFrames.length; i++) {
            api.setFrame(probeFrames[i]);
            var u = projectToPath(points, [api.get(layerId, 'position.x'), api.get(layerId, 'position.y')]);
            achieved.push(arcAt(table, u));
        }

        var sum = 0;
        for (var e = 0; e < achieved.length; e++) {
            sum += (achieved[e] - wanted[e]) * (achieved[e] - wanted[e]);
        }
        var rms = Math.sqrt(sum / achieved.length);

        if (!best || rms < best.rms) {
            best = { rms: rms, velocity: candidate };
        }
        if (rms <= SOLVE_TOLERANCE) {
            break;
        }

        // Fell short by (wanted - achieved), so ask for that much more next round.
        for (var k = 0; k < ask.length; k++) {
            ask[k] = Math.max(0, Math.min(1, ask[k] + (wanted[k] - achieved[k])));
        }
    }

    writeSegmentVelocity(layerId, frameA, frameB, best.velocity, velocityByFrame);
    return best.rms;
}

/** Stage one candidate onto the run's velocity map and push it to Cavalry. */
function writeSegmentVelocity(layerId, frameA, frameB, candidate, velocityByFrame) {
    velocityByFrame[frameA].rightSpeed = candidate.rightSpeed;
    velocityByFrame[frameA].rightInfluence = candidate.rightInfluence;
    velocityByFrame[frameB].leftSpeed = candidate.leftSpeed;
    velocityByFrame[frameB].leftInfluence = candidate.leftInfluence;
    [frameA, frameB].forEach(function (frame) {
        var v = velocityByFrame[frame];
        try {
            api.setKeyframeVelocity(layerId, {
                'position.x': {
                    frame: frame,
                    leftSpeed: v.leftSpeed,
                    rightSpeed: v.rightSpeed,
                    leftInfluence: v.leftInfluence,
                    rightInfluence: v.rightInfluence
                },
                'position.y': {
                    frame: frame,
                    leftSpeed: v.leftSpeed,
                    rightSpeed: v.rightSpeed,
                    leftInfluence: v.leftInfluence,
                    rightInfluence: v.rightInfluence
                }
            });
        } catch (e) {}
    });
}

/**
 * Re-sync the temporal component of a motion path run's bezier handles across both position
 * channels. See sharedTangentOffset for why they must match and how Cavalry splits them.
 *
 * Only handles that govern a segment INSIDE the run are touched: the run's leading in-handle
 * and trailing out-handle belong to segments the user did not select, and a keyframe's two
 * handles are independent, so leaving them alone leaves the neighbouring segments untouched.
 * Each channel keeps its own bez.y — that is the spatial offset, the shape the user drew. Only
 * the clock is rewritten, which is what makes the render agree with the handles already on
 * screen rather than moving the path somewhere new.
 *
 * @returns {Array<string>} descriptions of what was repaired, for logging
 */
function repairMotionPathTangents(layerId, frames, valuesX, valuesY) {
    var repaired = [];
    var data = {};

    function keyframeData(attrId, frame) {
        var cacheKey = attrId + '@' + frame;
        if (data[cacheKey] !== undefined) {
            return data[cacheKey];
        }
        var result = null;
        try {
            var times = api.getKeyframeTimes(layerId, attrId);
            var ids = api.getKeyframeIdsForAttribute(layerId, attrId);
            var index = times.indexOf(frame);
            if (index !== -1 && ids[index]) {
                result = api.get(ids[index], 'data') || null;
            }
        } catch (e) {}
        data[cacheKey] = result;
        return result;
    }

    // An out-handle governs the segment ahead of its keyframe, an in-handle the segment behind.
    for (var i = 0; i < frames.length; i++) {
        var sides = [];
        if (i < frames.length - 1) {
            sides.push({ side: 'out', frameDiff: frames[i + 1] - frames[i] });
        }
        if (i > 0) {
            sides.push({ side: 'in', frameDiff: frames[i] - frames[i - 1] });
        }

        for (var s = 0; s < sides.length; s++) {
            var isOut = sides[s].side === 'out';
            var frame = frames[i];
            var dataX = keyframeData('position.x', frame);
            var dataY = keyframeData('position.y', frame);
            if (!dataX || !dataY) {
                continue;
            }
            var handleX = isOut ? dataX.rightBez : dataX.leftBez;
            var handleY = isOut ? dataY.rightBez : dataY.leftBez;
            if (!handleX || !handleY) {
                continue;
            }

            var shared = sharedTangentOffset(handleX.x, handleY.x, sides[s].frameDiff);
            if (shared === null) {
                continue;
            }

            var axes = [
                { attrId: 'position.x', value: valuesX[i], handle: handleX },
                { attrId: 'position.y', value: valuesY[i], handle: handleY }
            ];
            for (var a = 0; a < axes.length; a++) {
                var write = {};
                write[axes[a].attrId] = {
                    frame: frame,
                    xValue: frame + shared,
                    yValue: axes[a].value + axes[a].handle.y,
                    angleLocked: false,
                    weightLocked: false
                };
                write[axes[a].attrId][isOut ? 'outHandle' : 'inHandle'] = true;
                try {
                    api.modifyKeyframeTangent(layerId, write);
                } catch (e) {}
            }

            repaired.push(
                'frame ' + frame + ' ' + sides[s].side + ' (' +
                handleX.x.toFixed(2) + ' / ' + handleY.x.toFixed(2) + ' -> ' + shared.toFixed(2) + ')'
            );
        }
    }

    return repaired;
}

/**
 * Apply easing via setKeyframeVelocity for a contiguous motion-path run (both position.x and position.y).
 */
function applyVelocityToMotionPathGroup(layerId, keyframeIds, frames, currentEasing) {
    var n = frames.length;
    if (n < 2 || keyframeIds.length !== n) {
        return;
    }

    var valuesX = [];
    var valuesY = [];
    var savedFrame = api.getFrame();
    for (var vi = 0; vi < n; vi++) {
        api.setFrame(frames[vi]);
        valuesX.push(api.get(layerId, 'position.x'));
        valuesY.push(api.get(layerId, 'position.y'));
    }
    api.setFrame(savedFrame);

    // Before measuring anything: a run whose channels have drifted apart renders a path that
    // does not follow its own handles, and the solver would happily fit correct easing to that
    // broken shape. Re-sync first so everything downstream measures the real path.
    try {
        var repairs = repairMotionPathTangents(layerId, frames, valuesX, valuesY);
        if (repairs.length) {
            console.log(
                'Repaired ' + repairs.length + ' desynced motion path tangent(s) — ' +
                'position.x and position.y had drifted onto different timings, which kinks the ' +
                'path. ' + repairs.join(', ')
            );
        }
    } catch (repairError) {
        console.log('Motion path tangent repair failed:', repairError.message);
    }

    var velocityByFrame = {};
    for (var i = 0; i < n; i++) {
        var f = frames[i];
        var kd = api.get(keyframeIds[i], 'data');
        velocityByFrame[f] = {
            leftSpeed: kd && kd.leftSpeed !== undefined && kd.leftSpeed !== null ? kd.leftSpeed : DEFAULT_LEFT_SPEED,
            leftInfluence:
                kd && kd.leftInfluence !== undefined && kd.leftInfluence !== null
                    ? kd.leftInfluence
                    : DEFAULT_LEFT_INFLUENCE,
            rightSpeed: kd && kd.rightSpeed !== undefined && kd.rightSpeed !== null ? kd.rightSpeed : DEFAULT_RIGHT_SPEED,
            rightInfluence:
                kd && kd.rightInfluence !== undefined && kd.rightInfluence !== null
                    ? kd.rightInfluence
                    : DEFAULT_RIGHT_INFLUENCE
        };
    }
    for (var j = 0; j < n - 1; j++) {
        var f0 = frames[j];
        var f1 = frames[j + 1];

        // Untouched since Get read it: put back exactly what was there. Reconverting the
        // fitted curve would drift a segment the user never edited.
        if (restoreUneditedVelocity(layerId, f0, f1, currentEasing, velocityByFrame)) {
            continue;
        }

        var isHold = _clampHoldsEnabled &&
            valuesAreIdentical(valuesX[j], valuesX[j + 1]) &&
            valuesAreIdentical(valuesY[j], valuesY[j + 1]);
        var isStraight = !isHold && segmentPathIsStraight(
            layerId, f0, f1,
            valuesX[j], valuesX[j + 1],
            valuesY[j], valuesY[j + 1]
        );

        if (isStraight) {
            // Straight path: tangent easing matches a cubic-bezier exactly, so single-channel
            // attributes (scale, rotation…) eased with the same curve stay in lockstep.
            applyTangentEasingToPathSegment(
                layerId, f0, f1,
                valuesX[j], valuesX[j + 1],
                valuesY[j], valuesY[j + 1],
                currentEasing
            );
            velocityByFrame[f0].rightSpeed = TANGENT_MODE_SPEED;
            velocityByFrame[f1].leftSpeed = TANGENT_MODE_SPEED;
        } else if (isHold) {
            velocityByFrame[f0].rightSpeed = 0;
            velocityByFrame[f0].rightInfluence = DEFAULT_RIGHT_INFLUENCE;
            velocityByFrame[f1].leftSpeed = 0;
            velocityByFrame[f1].leftInfluence = DEFAULT_LEFT_INFLUENCE;
            flattenHandlesBetweenPair(layerId, 'position.x', f0, f1);
            flattenHandlesBetweenPair(layerId, 'position.y', f0, f1);
        } else {
            // Curved path: what the eye reads as easing is distance over time, and a curved
            // segment does not spread its distance evenly across its bezier parameter. Solve
            // against the distance actually rendered rather than converting the curve blind.
            var residual = null;
            try {
                residual = solveMotionPathSegment(
                    layerId, f0, f1,
                    valuesX[j], valuesY[j],
                    valuesX[j + 1], valuesY[j + 1],
                    currentEasing, velocityByFrame
                );
            } catch (solveError) {
                console.log('Motion path solve failed at frame ' + f0 + ':', solveError.message);
            }

            if (residual === null) {
                var v = cubicBezierToVelocity(
                    currentEasing.x1,
                    currentEasing.y1,
                    currentEasing.x2,
                    currentEasing.y2,
                    f1 - f0
                );
                velocityByFrame[f0].rightSpeed = v.rightSpeed;
                velocityByFrame[f0].rightInfluence = v.rightInfluence;
                velocityByFrame[f1].leftSpeed = v.leftSpeed;
                velocityByFrame[f1].leftInfluence = v.leftInfluence;
            } else if (residual > SOLVE_TOLERANCE * 3) {
                // The four speed/influence values cannot express every warp a path's geometry
                // can impose. Say so rather than leaving the user to wonder why one segment
                // still drifts from the curve they picked.
                console.log(
                    'Frames ' + f0 + '-' + f1 + ': path geometry limits how closely the easing can be ' +
                    'matched (off by ' + Math.round(residual * 100) + '% of the segment). Shortening the ' +
                    'motion path handles will improve it.'
                );
            }
        }
    }
    api.setFrame(savedFrame);   // straightness sampling scrubs the timeline
    for (var k = 0; k < n; k++) {
        var fr = frames[k];
        var vel = velocityByFrame[fr];
        try {
            api.setKeyframeVelocity(layerId, {
                'position.x': {
                    frame: fr,
                    leftSpeed: vel.leftSpeed,
                    rightSpeed: vel.rightSpeed,
                    leftInfluence: vel.leftInfluence,
                    rightInfluence: vel.rightInfluence
                },
                'position.y': {
                    frame: fr,
                    leftSpeed: vel.leftSpeed,
                    rightSpeed: vel.rightSpeed,
                    leftInfluence: vel.leftInfluence,
                    rightInfluence: vel.rightInfluence
                }
            });
        } catch (e) {
            console.log('Error setKeyframeVelocity at frame ' + fr + ':', e.message);
        }
    }
}

function velocityRunKey(layerId, frame) {
    return layerId + '|' + frame;
}

/**
 * Ensure keyframes are set to bezier interpolation and unlock tangents
 */
function ensureBezierInterpolation(keyframeId, attrId, layerId, frame) {
    try {
        var keyData = api.get(keyframeId, 'data');
        if (!keyData) {
            console.log("Could not get keyframe data for:", keyframeId);
            return false;
        }
        
        if (keyData.interpolation !== 0) {
            try {
                api.modifyKeyframe(keyframeId, 'interpolation', 0);
            } catch (e) {
                console.log("Could not set interpolation to bezier:", e.message);
            }
        }
        
        try {
            api.set(keyframeId, 'locked', false);
            api.set(keyframeId, 'weightLocked', false);
        } catch (e) {
            console.log("Failed to unlock keyframe tangents with api.set():", e.message);
        }
        
        return true;
    } catch (error) {
        console.log("Error ensuring bezier interpolation:", error.message);
        return false;
    }
}

/**
 * True when a keyframe's in/out handle is already flat (zero length), or has no handle data.
 * Cavalry keyframes cannot be unlocked from script ('locked' is not a settable attribute),
 * and flattening a handle that is ALREADY flat makes Cavalry apply the angle to the other
 * handle too — which wipes the neighbouring segment's spatial tangent. So don't write it.
 */
function handleIsFlat(layerId, attrId, frame, side) {
    try {
        var times = api.getKeyframeTimes(layerId, attrId);
        var ids = api.getKeyframeIdsForAttribute(layerId, attrId);
        var i = times.indexOf(frame);
        if (i === -1 || !ids[i]) return false;
        var data = api.get(ids[i], 'data') || {};
        var handle = side === 'in' ? data.leftBez : data.rightBez;
        if (!handle) return true;
        return Math.abs(handle.x) < 0.001 && Math.abs(handle.y) < 0.001;
    } catch (e) {
        return false;
    }
}

/**
 * Strip the stale speed + influence off a position channel that is no longer a motion path.
 *
 * Speed fields outlive the path that created them: delete one position channel and the
 * survivor keeps them, and Cavalry goes on evaluating those segments from speed rather than
 * from their handles. Easing written as handles then does nothing — measured on a real
 * orphaned segment, a full Apply moved it from 0.6077 to 0.6674 at the midpoint when the
 * handles alone called for 0.1046.
 *
 * The fields cannot be written away (modifyKeyframe throws on rightSpeed / rightInfluence)
 * and cannot be neutralised (speed 1 is simply another speed, not an off switch). Deleting
 * and recreating the keyframe is the only thing that clears them.
 *
 * That deletion makes Cavalry re-derive the surviving neighbours' tangents, which wrecks the
 * segments either side: measured, the trailing neighbour went from 0.3274 to 0.0659 at its
 * first sample. Restoring only the outer keys' handles is not enough — a segment is bound by
 * a handle at BOTH ends, so the recreated keys' outward-facing handles matter just as much.
 * Snapshotting all four and writing them back restores both neighbours exactly.
 *
 * Only the handles facing the orphaned segments themselves are dropped, and the caller
 * overwrites those immediately with the easing being applied.
 *
 * @param {Object} group - {layerId, attrId, frames, keyframeIds}
 * @returns {boolean} true if anything was recreated (the group's keyframeIds are now stale)
 */
function repairOrphanedVelocitySegments(group) {
    var siblingTimes = getSiblingKeyframeTimesSet(group.layerId, group.attrId);
    // null means this is not a position channel, and nothing else carries speed fields.
    if (!siblingTimes) {
        return false;
    }

    var times, ids;
    try {
        times = api.getKeyframeTimes(group.layerId, group.attrId) || [];
        ids = api.getKeyframeIdsForAttribute(group.layerId, group.attrId) || [];
    } catch (e) {
        return false;
    }
    if (times.length < 2 || ids.length !== times.length) {
        return false;
    }

    var data = ids.map(function (id) {
        try { return api.get(id, 'data') || {}; } catch (e) { return {}; }
    });

    function hasSpeed(value) {
        return value !== undefined && value !== null;
    }
    // A recreated keyframe comes back bare, losing its interpolation along with everything
    // else. Dropping a hold that way would be a silent, invisible edit, so leave those alone
    // and accept that a held orphan keeps its stale fields.
    function isPlainBezier(d) {
        return d.interpolation === undefined || d.interpolation === 0;
    }

    // Which segments across the WHOLE attribute are orphaned — not just the selected ones.
    // A recreate rewrites its neighbours regardless of what the user selected, so the scan
    // has to see the same span the damage would.
    var orphaned = [];
    for (var s = 0; s < times.length - 1; s++) {
        if (isMotionPathPair(siblingTimes, times[s], times[s + 1])) continue;
        if (!hasSpeed(data[s].rightSpeed) || !hasSpeed(data[s + 1].leftSpeed)) continue;
        if (!isPlainBezier(data[s]) || !isPlainBezier(data[s + 1])) continue;
        orphaned.push(s);
    }
    if (orphaned.length === 0) {
        return false;
    }

    var doomed = new Set();
    var facing = new Set();
    orphaned.forEach(function (s) {
        doomed.add(times[s]);
        doomed.add(times[s + 1]);
        // The two handles that shape the orphaned segment itself. Deliberately not restored.
        facing.add(times[s] + '|out');
        facing.add(times[s + 1] + '|in');
    });

    var restoreFrame = api.getFrame();
    try {
        // modifyKeyframeTangent takes ABSOLUTE coordinates, so each handle has to be resolved
        // against the value at its own keyframe's frame before anything is deleted.
        var snapshot = [];
        var values = {};
        for (var v = 0; v < times.length; v++) {
            api.setFrame(times[v]);
            values[times[v]] = api.get(group.layerId, group.attrId);
        }
        for (var h = 0; h < times.length; h++) {
            var frame = times[h];
            var base = values[frame];
            if (data[h].leftBez && !facing.has(frame + '|in')) {
                snapshot.push({ frame: frame, side: 'in', xv: frame + data[h].leftBez.x, yv: base + data[h].leftBez.y });
            }
            if (data[h].rightBez && !facing.has(frame + '|out')) {
                snapshot.push({ frame: frame, side: 'out', xv: frame + data[h].rightBez.x, yv: base + data[h].rightBez.y });
            }
        }

        doomed.forEach(function (frame) {
            try { api.deleteKeyframe(group.layerId, group.attrId, frame); } catch (e) {}
        });
        doomed.forEach(function (frame) {
            var payload = {};
            payload[group.attrId] = values[frame];
            try { api.keyframe(group.layerId, frame, payload); } catch (e) {}
        });

        snapshot.forEach(function (h2) {
            var obj = {};
            obj[group.attrId] = {
                frame: h2.frame,
                inHandle: h2.side === 'in',
                outHandle: h2.side === 'out',
                xValue: h2.xv,
                yValue: h2.yv,
                angleLocked: false,
                weightLocked: false
            };
            try { api.modifyKeyframeTangent(group.layerId, obj); } catch (e) {}
        });
    } catch (e) {
        console.log("Error repairing orphaned velocity segments: " + e.message);
    } finally {
        api.setFrame(restoreFrame);
    }

    return true;
}

/**
 * Zero out the tangent handles between two keyframes (outgoing of first, incoming of second).
 * Uses angle=0, weight=0 to flatten without disturbing the other side's easing.
 * Already-flat handles are skipped — see handleIsFlat.
 */
function flattenHandlesBetweenPair(layerId, attrId, frameA, frameB) {
    var unlocked = { angleLocked: false, weightLocked: false };
    if (!handleIsFlat(layerId, attrId, frameA, 'out')) {
      try {
        var outObj = {};
        outObj[attrId] = {
            frame: frameA,
            outHandle: true,
            angle: 0,
            weight: 0,
            ...unlocked
        };
        api.modifyKeyframeTangent(layerId, outObj);
      } catch (e) {}
    }
    if (!handleIsFlat(layerId, attrId, frameB, 'in')) {
      try {
        var inObj = {};
        inObj[attrId] = {
            frame: frameB,
            inHandle: true,
            angle: 0,
            weight: 0,
            ...unlocked
        };
        api.modifyKeyframeTangent(layerId, inObj);
      } catch (e) {}
    }
}

/**
 * Apply easing to a single pair of keyframes
 */
function applyEasingToKeyframePair(currentKeyId, nextKeyId, currentKeyData, nextKeyData, cavalryHandles, attrId, layerId, currentFrame, currentValue, nextFrame, nextValue) {
    try {
        currentKeyData = api.get(currentKeyId, 'data');
        nextKeyData = api.get(nextKeyId, 'data');
        
        try {
            var unlocked = { angleLocked: false, weightLocked: false };
            
            if (currentKeyData) {
                var tangentObj1 = {};
                tangentObj1[attrId] = {
                    frame: currentFrame,
                    inHandle: false,
                    outHandle: true,
                    xValue: currentFrame + cavalryHandles.outHandleX,
                    yValue: currentValue + cavalryHandles.outHandleY,
                    ...unlocked
                };
                api.modifyKeyframeTangent(layerId, tangentObj1);
            }
            
            if (nextKeyData) {
                var tangentObj2 = {};
                tangentObj2[attrId] = {
                    frame: nextFrame,
                    inHandle: true,
                    outHandle: false,
                    xValue: nextFrame + cavalryHandles.inHandleX,
                    yValue: nextValue + cavalryHandles.inHandleY,
                    ...unlocked
                };
                api.modifyKeyframeTangent(layerId, tangentObj2);
            }
            
        } catch (e) {
            try {
                if (currentKeyData && currentKeyData.rightBez) {
                    api.modifyKeyframe(currentKeyId, 'rightBez.x', cavalryHandles.outHandleX);
                    api.modifyKeyframe(currentKeyId, 'rightBez.y', cavalryHandles.outHandleY);
                }
                
                if (nextKeyData && nextKeyData.leftBez) {
                    api.modifyKeyframe(nextKeyId, 'leftBez.x', cavalryHandles.inHandleX);
                    api.modifyKeyframe(nextKeyId, 'leftBez.y', cavalryHandles.inHandleY);
                }
            } catch (e2) {
                console.log("Error: Alternative approach also failed:", e2.message);
            }
        }
        
        return true;
    } catch (error) {
        console.log("Error applying easing to keyframe pair:", error.message);
        return false;
    }
}

/**
 * Apply easing to a single keyframe's both handles independently
 */
function applyEasingToSingleKeyframe(keyframeId, attrId, layerId, frame, value, currentEasing) {
    try {
        var defaultFrameDiff = 30;
        var defaultValueDiff = 100;
        
        var cavalryHandles = cubicBezierToCavalry(
            currentEasing.x1, currentEasing.y1, 
            currentEasing.x2, currentEasing.y2, 
            defaultFrameDiff, defaultValueDiff
        );
        
        var keyData = api.get(keyframeId, 'data');
        if (keyData && keyData.interpolation !== 0) {
            api.modifyKeyframe(keyframeId, 'interpolation', 0);
            keyData = api.get(keyframeId, 'data');
        }
        
        if (keyData) {
            if (!keyData.leftBez) {
                try {
                    api.modifyKeyframe(keyframeId, 'leftBez.x', 0);
                    api.modifyKeyframe(keyframeId, 'leftBez.y', 0);
                } catch (e) {}
            }
            if (!keyData.rightBez) {
                try {
                    api.modifyKeyframe(keyframeId, 'rightBez.x', 0);
                    api.modifyKeyframe(keyframeId, 'rightBez.y', 0);
                } catch (e) {}
            }
        }
        
        var unlocked = { angleLocked: false, weightLocked: false };
        
        var tangentObjOut = {};
        tangentObjOut[attrId] = {
            frame: frame,
            inHandle: false,
            outHandle: true,
            xValue: frame + cavalryHandles.outHandleX,
            yValue: value + cavalryHandles.outHandleY,
            ...unlocked
        };
        api.modifyKeyframeTangent(layerId, tangentObjOut);
        
        var tangentObjIn = {};
        tangentObjIn[attrId] = {
            frame: frame,
            inHandle: true,
            outHandle: false,
            xValue: frame + cavalryHandles.inHandleX,
            yValue: value + cavalryHandles.inHandleY,
            ...unlocked
        };
        api.modifyKeyframeTangent(layerId, tangentObjIn);
        
        return true;
    } catch (error) {
        console.log("Error applying easing to single keyframe:", error.message);
        return false;
    }
}

function velocityFitKey(layerId, attrId, frameA, frameB) {
    return layerId + '|' + attrId + '|' + frameA + '|' + frameB;
}

/**
 * Recover a velocity-driven segment's easing by measuring what it actually renders.
 *
 * Cavalry's speed + influence does not map onto a cubic-bezier the way the standard formula
 * assumes, so converting the numbers reports a curve the layer is not following. Measured on
 * a 600px move: Cavalry's own defaults (speed 1, influence 0.333) read as 14px off, and
 * livelier settings as much as 79px. Sampling the rendered motion and fitting a bezier to it
 * lands within 0.3px to 17px across the same cases — better in every one.
 *
 * The fit is also indifferent to WHY the formula disagrees. Whether it is the speed mapping,
 * the arc-length pre-warping this file's path solver already contends with, or something
 * that changes in a future Cavalry release, the fit tracks whatever is on screen.
 *
 * Seeding the search with the formula's answer was measured slower and no more accurate, so
 * fitEase starts from its own default.
 *
 * Scrubs the timeline; the caller restores the frame.
 *
 * @returns {Object|null} {x1, y1, x2, y2}, or null when the segment carries no value change
 *          to normalise against
 */
function fitSegmentEasing(layerId, attrId, frameA, frameB, frameDiff, firstValue, valueDiff) {
    if (Math.abs(valueDiff) < IDENTICAL_VALUE_EPSILON || !(frameDiff > 0)) {
        return null;
    }

    // Never ask for more samples than the segment has frames — setFrame takes integers, and
    // oversampling a short segment just reads the same frame repeatedly.
    var count = Math.max(2, Math.min(VELOCITY_FIT_SAMPLES, Math.round(frameDiff)));
    var times = [];
    var values = [];

    for (var i = 0; i <= count; i++) {
        var frame = Math.round(frameA + (i / count) * frameDiff);
        api.setFrame(frame);
        // Time comes from the frame actually sampled, not the ideal fraction, so rounding
        // cannot skew the fit.
        times.push((frame - frameA) / frameDiff);
        values.push((api.get(layerId, attrId) - firstValue) / valueDiff);
    }

    var fitted = fitEase(times, values, Math.max(0.01, 1 / frameDiff));
    return { x1: fitted.x1, y1: fitted.y1, x2: fitted.x2, y2: fitted.y2 };
}

/**
 * Recover a curved motion path segment's easing by measuring DISTANCE travelled over time.
 *
 * A single position channel is not a usable progress signal on a curved path. Measured on a
 * real 65-frame segment whose path is 3.7x longer than its straight-line distance, position.x
 * runs backwards on 12 of 65 frames and swings to -1.26 of the segment's span before arriving.
 * Fitting a monotonic easing curve to that is impossible: fitEase pinned both its influence
 * bounds and returned 1, 0, 0, 0.197 at rms 0.46, a curve with no relationship to the motion.
 * Against arc length the same segment fits to 0.125, 0, 0.109, 1 at rms 0.0026.
 *
 * Distance comes from the same arc table and projection the write-side solver uses, rather
 * than summing chords between sampled frames: where the layer covers hundreds of units in one
 * frame the chord badly understates the distance, and that error is largest exactly where the
 * easing is steepest.
 *
 * Scrubs the timeline; the caller restores the frame.
 *
 * @returns {Object|null} {x1, y1, x2, y2}, or null when the path could not be measured
 */
function fitMotionPathEasing(layerId, frameA, frameB, frameDiff) {
    if (!(frameDiff > 0)) {
        return null;
    }

    api.setFrame(frameA);
    var startX = api.get(layerId, 'position.x');
    var startY = api.get(layerId, 'position.y');
    api.setFrame(frameB);
    var endX = api.get(layerId, 'position.x');
    var endY = api.get(layerId, 'position.y');

    var points = motionPathControlPoints(layerId, frameA, frameB, startX, startY, endX, endY);
    if (!points) {
        return null;
    }
    var table = buildArcTable(points);
    if (!(table.total > 0)) {
        return null;
    }

    var count = Math.max(2, Math.min(VELOCITY_FIT_SAMPLES, Math.round(frameDiff)));
    var times = [];
    var values = [];

    for (var i = 0; i <= count; i++) {
        var frame = Math.round(frameA + (i / count) * frameDiff);
        api.setFrame(frame);
        var u = projectToPath(points, [api.get(layerId, 'position.x'), api.get(layerId, 'position.y')]);
        times.push((frame - frameA) / frameDiff);
        values.push(arcAt(table, u));
    }

    var fitted = fitEase(times, values, Math.max(0.01, 1 / frameDiff));
    return { x1: fitted.x1, y1: fitted.y1, x2: fitted.x2, y2: fitted.y2 };
}

/**
 * True when a motion path segment should keep the speed + influence it already has.
 *
 * Get reads these segments by fitting the motion they render rather than by converting their
 * speed and influence, because the conversion does not describe what Cavalry draws. That
 * makes the round trip lossy in the other direction too: converting the fit back would nudge
 * a curve the user never touched. So when the easing is still exactly what the fit returned,
 * and the keyframes still carry the values it was measured from, the originals stay.
 *
 * Returns true meaning "leave it alone" — velocityByFrame is already seeded from the live
 * keyframes, so declining to write is the restore.
 */
function restoreUneditedVelocity(layerId, frameA, frameB, currentEasing, velocityByFrame) {
    var entry = _velocityFits[velocityFitKey(layerId, 'position.x', frameA, frameB)] ||
                _velocityFits[velocityFitKey(layerId, 'position.y', frameA, frameB)];

    return velocityFitIsUnedited(entry, currentEasing, velocityByFrame[frameA], velocityByFrame[frameB]);
}

/**
 * The decision behind restoreUneditedVelocity, split out so it can be tested without a scene.
 *
 * @param {Object|null} entry - cached {easing, velocity}, or null when nothing was fitted
 * @param {Object} currentEasing - the curve about to be applied
 * @param {Object} live0 - speed/influence currently on the start keyframe
 * @param {Object} live1 - speed/influence currently on the end keyframe
 * @returns {boolean} true when the segment should be left exactly as it is
 */
export function velocityFitIsUnedited(entry, currentEasing, live0, live1) {
    if (!entry || !entry.easing || !entry.velocity || !currentEasing || !live0 || !live1) {
        return false;
    }

    // Exact equality on purpose. Any drag, preset or typed value produces a different number,
    // so this cannot swallow a real edit; the cost of being wrong the other way is silently
    // discarding one.
    var e = entry.easing;
    if (e.x1 !== currentEasing.x1 || e.y1 !== currentEasing.y1 ||
        e.x2 !== currentEasing.x2 || e.y2 !== currentEasing.y2) {
        return false;
    }

    // The scene can move under a cached fit — edited in Cavalry's own graph editor, undone,
    // rebuilt. Only trust it while the keyframes still hold what it was measured from.
    var v = entry.velocity;
    return live0.rightSpeed === v.rightSpeed && live0.rightInfluence === v.rightInfluence &&
           live1.leftSpeed === v.leftSpeed && live1.leftInfluence === v.leftInfluence;
}

/**
 * Read one segment's normalised easing from the two keyframes bounding it.
 *
 * Scrubs the timeline to sample the values, so the caller restores api.getFrame() once it
 * has read everything it needs.
 *
 * @param {string} layerId
 * @param {string} attrId
 * @param {string} keyIdA - keyframe id at frameA
 * @param {string} keyIdB - keyframe id at frameB
 * @param {number} frameA - earlier frame
 * @param {number} frameB - later frame
 * @returns {{ frameDiff: number, valueDiff: number, easing: Object }|null}
 */
function readSegment(layerId, attrId, keyIdA, keyIdB, frameA, frameB) {
    var frameDiff = frameB - frameA;
    if (!keyIdA || !keyIdB || !(frameDiff > 0)) {
        return null;
    }

    api.setFrame(frameA);
    var firstValue = api.get(layerId, attrId);
    api.setFrame(frameB);
    var secondValue = api.get(layerId, attrId);

    var valueDiff = secondValue - firstValue;

    var firstKeyData = api.get(keyIdA, 'data');
    var secondKeyData = api.get(keyIdB, 'data');
    if (!firstKeyData || !secondKeyData) {
        return null;
    }

    // Which id holds the segment's start is decided by value, not by id order.
    var frameZeroData, frameEndData;
    if (Math.abs(firstKeyData.numValue - firstValue) < 0.1) {
        frameZeroData = firstKeyData;
        frameEndData = secondKeyData;
    } else {
        frameZeroData = secondKeyData;
        frameEndData = firstKeyData;
    }

    var easing;
    if (segmentUsesVelocity(frameZeroData, frameEndData)) {
        // Velocity-eased segment: the handles are flat and the easing lives in speed +
        // influence, which does not convert faithfully — so measure the motion instead.
        var velocity = {
            rightSpeed: frameZeroData.rightSpeed,
            rightInfluence: frameZeroData.rightInfluence,
            leftSpeed: frameEndData.leftSpeed,
            leftInfluence: frameEndData.leftInfluence
        };

        // On a curved path a single channel is not progress — it can run backwards and
        // overshoot its own endpoints while the layer only ever moves forwards along the
        // path. Measure distance travelled instead whenever both channels are keyed here.
        var siblingTimes = getSiblingKeyframeTimesSet(layerId, attrId);
        if (isMotionPathPair(siblingTimes, frameA, frameB)) {
            easing = fitMotionPathEasing(layerId, frameA, frameB, frameDiff);
        }

        if (!easing) {
            easing = fitSegmentEasing(layerId, attrId, frameA, frameB, frameDiff, firstValue, valueDiff);
        }

        if (easing) {
            if (Object.keys(_velocityFits).length > VELOCITY_FIT_CACHE_MAX) {
                _velocityFits = {};
            }
            _velocityFits[velocityFitKey(layerId, attrId, frameA, frameB)] = {
                easing: { x1: easing.x1, y1: easing.y1, x2: easing.x2, y2: easing.y2 },
                velocity: velocity
            };
        } else {
            // Nothing to measure against — a hold, or a channel that does not move. The
            // formula is no worse than nothing here.
            easing = velocityToCubicBezier(
                velocity.rightSpeed,
                velocity.rightInfluence,
                velocity.leftSpeed,
                velocity.leftInfluence
            );
        }
    } else if (frameZeroData.rightBez && frameEndData.leftBez) {
        easing = cavalryToCubicBezier(
            frameZeroData.rightBez.x,
            frameZeroData.rightBez.y,
            frameEndData.leftBez.x,
            frameEndData.leftBez.y,
            frameDiff,
            valueDiff
        );
    } else {
        easing = { x1: 0, y1: 0, x2: 1, y2: 1 };
    }

    return { frameDiff: frameDiff, valueDiff: valueDiff, easing: easing };
}

/**
 * The segments either side of the selected one, for the read-only ghost curves.
 *
 * Only answers when the selection is a single unambiguous segment. With several segments
 * selected the graph shows their AVERAGE, and there is no honest neighbour for an average —
 * better to show nothing than to imply the ghosts connect to the curve on screen.
 *
 * Nothing here writes. The neighbouring keyframes are read and left exactly as found.
 *
 * @returns {{ sel: Object, prev: Object|null, next: Object|null }|null}
 */
export function readNeighbourSegments() {
    var restoreFrame = api.getFrame();
    try {
        var selectedKeyframes = api.getSelectedKeyframes();

        // A motion path selects position.x and position.y together and they share one clock,
        // so that pair is still one segment. Any other multi-attribute selection is not.
        var candidates = [];
        for (let [fullAttributePath, frames] of Object.entries(selectedKeyframes)) {
            if (!frames || frames.length === 0) continue;
            if (frames.length !== 2) return null;

            var dotAfterHash = fullAttributePath.indexOf('.', fullAttributePath.indexOf('#'));
            if (fullAttributePath.indexOf('#') === -1 || dotAfterHash === -1) return null;

            candidates.push({
                layerId: fullAttributePath.substring(0, dotAfterHash),
                attrId: fullAttributePath.substring(dotAfterHash + 1),
                frames: frames.slice().sort(function (a, b) { return a - b; })
            });
        }

        if (candidates.length === 0) return null;
        if (candidates.length > 1) {
            var axes = candidates.map(function (c) { return c.attrId; }).sort();
            var sameFrames = candidates.every(function (c) {
                return c.frames[0] === candidates[0].frames[0] && c.frames[1] === candidates[0].frames[1];
            });
            var isPathPair = candidates.length === 2 &&
                axes[0] === 'position.x' && axes[1] === 'position.y' &&
                candidates[0].layerId === candidates[1].layerId && sameFrames;
            if (!isPathPair) return null;
        }

        // For a motion path either axis carries the same timing, but the axis that barely
        // moves has a valueDiff near zero, which makes its value scale meaningless. Read the
        // axis that actually travels.
        var chosen = candidates[0];
        if (candidates.length > 1) {
            var best = -Infinity;
            for (var c = 0; c < candidates.length; c++) {
                api.setFrame(candidates[c].frames[0]);
                var v0 = api.get(candidates[c].layerId, candidates[c].attrId);
                api.setFrame(candidates[c].frames[1]);
                var v1 = api.get(candidates[c].layerId, candidates[c].attrId);
                var travel = Math.abs(v1 - v0);
                if (travel > best) {
                    best = travel;
                    chosen = candidates[c];
                }
            }
        }

        var times = api.getKeyframeTimes(chosen.layerId, chosen.attrId) || [];
        var ids = api.getKeyframeIdsForAttribute(chosen.layerId, chosen.attrId) || [];
        var startIndex = times.indexOf(chosen.frames[0]);
        var endIndex = times.indexOf(chosen.frames[1]);

        // Selecting two keyframes with others between them is not a segment either.
        if (startIndex === -1 || endIndex !== startIndex + 1) return null;

        var sel = readSegment(chosen.layerId, chosen.attrId, ids[startIndex], ids[endIndex], times[startIndex], times[endIndex]);
        if (!sel || Math.abs(sel.valueDiff) < IDENTICAL_VALUE_EPSILON) {
            // A hold gives no value scale to map a neighbour's values through.
            return null;
        }

        var prev = startIndex > 0
            ? readSegment(chosen.layerId, chosen.attrId, ids[startIndex - 1], ids[startIndex], times[startIndex - 1], times[startIndex])
            : null;
        var next = endIndex < times.length - 1
            ? readSegment(chosen.layerId, chosen.attrId, ids[endIndex], ids[endIndex + 1], times[endIndex], times[endIndex + 1])
            : null;

        if (!prev && !next) return null;

        return { sel: sel, prev: prev, next: next };
    } catch (e) {
        return null;
    } finally {
        api.setFrame(restoreFrame);
    }
}

/**
 * Get easing from selected keyframes
 * @param {Object} currentEasing - Current easing state to update
 * @returns {boolean} Success status
 */
export function getEasingFromKeyframes(currentEasing) {
    // Fits only need to survive until the matching Apply, and a stale one from an earlier
    // selection must never be mistaken for this one's.
    _velocityFits = {};
    try {
        var selectedKeyframes = api.getSelectedKeyframes();
        var keyframeIds = api.getSelectedKeyframeIds();
        
        if (keyframeIds.length < 1) {
            console.log("Error: Please select at least 1 keyframe");
            return false;
        }
        
        // If only 1 keyframe is selected, extract from its handles
        if (keyframeIds.length === 1) {
            var keyframeId = keyframeIds[0];
            var attrPath = api.getAttributeFromKeyframeId(keyframeId);
            
            var hashIndex = attrPath.indexOf('#');
            if (hashIndex === -1) {
                console.log("Error: Invalid layer ID format");
                return false;
            }
            
            var dotAfterHash = attrPath.indexOf('.', hashIndex);
            if (dotAfterHash === -1) {
                console.log("Error: Could not parse attribute");
                return false;
            }
            
            var layerId = attrPath.substring(0, dotAfterHash);
            var attrId = attrPath.substring(dotAfterHash + 1);
            
            var keyData = api.get(keyframeId, 'data');
            if (!keyData) {
                console.log("Error: Could not get keyframe data");
                return false;
            }
            
            if (!keyData.rightBez) {
                console.log("Single keyframe has no bezier handles - keeping current curve");
                return true;
            }
            
            var defaultFrameDiff = 30;
            var defaultValueDiff = 100;
            
            var outHandleX = keyData.rightBez.x;
            var outHandleY = keyData.rightBez.y;
            var inHandleX = -outHandleX;
            var inHandleY = -outHandleY;
            
            var bezier = cavalryToCubicBezier(outHandleX, outHandleY, inHandleX, inHandleY, defaultFrameDiff, defaultValueDiff);
            
            currentEasing.x1 = bezier.x1;
            currentEasing.y1 = bezier.y1;
            currentEasing.x2 = bezier.x2;
            currentEasing.y2 = bezier.y2;
            
            console.log("Extracted easing from single keyframe's handles");
            return true;
        }
        
        // Collect all attribute groups with 2+ keyframes
        var attributeGroups = {};
        
        for (let [fullAttributePath, frames] of Object.entries(selectedKeyframes)) {
            if (frames.length >= 2) {
                var hashIndex = fullAttributePath.indexOf('#');
                if (hashIndex === -1) continue;
                
                var dotAfterHash = fullAttributePath.indexOf('.', hashIndex);
                if (dotAfterHash === -1) continue;
                
                var layerId = fullAttributePath.substring(0, dotAfterHash);
                var attrId = fullAttributePath.substring(dotAfterHash + 1);
                
                var sortedFrames = frames.sort((a, b) => a - b);
                var attributeKeyframeIds = keyframeIdsForFrames(layerId, attrId, sortedFrames);

                if (attributeKeyframeIds.length >= 2 && attributeKeyframeIds.every(Boolean)) {
                    attributeGroups[fullAttributePath] = {
                        layerId: layerId,
                        attrId: attrId,
                        frames: sortedFrames,
                        keyframeIds: attributeKeyframeIds
                    };
                }
            }
        }
        
        if (Object.keys(attributeGroups).length === 0) {
            console.log("Error: No valid attribute groups found with 2+ keyframes");
            return false;
        }
        
        var totalX1 = 0, totalY1 = 0, totalX2 = 0, totalY2 = 0;
        var pairCount = 0;
        var currentFrame = api.getFrame();
        // A motion path's two axes carry identical velocity, so reading both would count the
        // same segment twice and report a bogus "averaged from 2 pairs".
        var seenPathSegments = new Set();
        
        for (let [attributePath, group] of Object.entries(attributeGroups)) {
            for (var i = 0; i < group.keyframeIds.length - 1; i++) {
                var currentKeyId = group.keyframeIds[i];
                var nextKeyId = group.keyframeIds[i + 1];
                
                var firstFrame = group.frames[i];
                var secondFrame = group.frames[i + 1];
                var frameDiff = secondFrame - firstFrame;
                
                if (frameDiff <= 0) continue;

                var isPositionAxis = group.attrId === 'position.x' || group.attrId === 'position.y';
                if (isPositionAxis) {
                    var segmentKey = group.layerId + '|position|' + firstFrame + '|' + secondFrame;
                    if (seenPathSegments.has(segmentKey)) continue;
                    seenPathSegments.add(segmentKey);
                }

                var segment = readSegment(group.layerId, group.attrId, currentKeyId, nextKeyId, firstFrame, secondFrame);
                if (!segment) continue;

                totalX1 += segment.easing.x1;
                totalY1 += segment.easing.y1;
                totalX2 += segment.easing.x2;
                totalY2 += segment.easing.y2;
                pairCount++;
            }
        }
        
        api.setFrame(currentFrame);
        
        if (pairCount === 0) {
            console.log("Error: Could not extract easing data from any keyframe pairs");
            return false;
        }
        
        currentEasing.x1 = totalX1 / pairCount;
        currentEasing.y1 = totalY1 / pairCount;
        currentEasing.x2 = totalX2 / pairCount;
        currentEasing.y2 = totalY2 / pairCount;
        
        if (pairCount > 1) {
            console.log("Averaged easing from " + pairCount + " keyframe pairs");
        }
        
        return true;
        
    } catch (error) {
        console.log("Error: " + error.message);
        return false;
    }
}

/**
 * Apply easing to selected keyframes
 * @param {Object} currentEasing - Current easing values to apply
 * @returns {boolean} Success status
 */
export function applyEasingToKeyframes(currentEasing) {
    try {
        var selectedKeyframes = api.getSelectedKeyframes();
        var keyframeIds = api.getSelectedKeyframeIds();
        
        if (keyframeIds.length < 1) {
            console.log("Error: Please select at least 1 keyframe");
            return false;
        }
        
        // Single keyframe case
        if (keyframeIds.length === 1) {
            var keyframeId = keyframeIds[0];
            var attrPath = api.getAttributeFromKeyframeId(keyframeId);
            
            var hashIndex = attrPath.indexOf('#');
            if (hashIndex === -1) {
                console.log("Error: Invalid layer ID format");
                return false;
            }
            
            var dotAfterHash = attrPath.indexOf('.', hashIndex);
            if (dotAfterHash === -1) {
                console.log("Error: Could not parse attribute");
                return false;
            }
            
            var layerId = attrPath.substring(0, dotAfterHash);
            var attrId = attrPath.substring(dotAfterHash + 1);
            
            var keyframeFrame = null;
            for (let [path, frames] of Object.entries(selectedKeyframes)) {
                if (path === attrPath && frames.length === 1) {
                    keyframeFrame = frames[0];
                    break;
                }
            }
            
            if (keyframeFrame === null) {
                console.log("Error: Could not determine keyframe frame number");
                return false;
            }
            
            var currentFrame = api.getFrame();
            api.setFrame(keyframeFrame);
            var value = api.get(layerId, attrId);
            
            var success = applyEasingToSingleKeyframe(keyframeId, attrId, layerId, keyframeFrame, value, currentEasing);
            
            api.setFrame(currentFrame);
            
            if (success) {
                console.log("Applied easing to single keyframe's incoming and outgoing handles");
            }
            
            return success;
        }
        
        // Group keyframes by attribute path
        var attributeGroups = {};
        
        for (let [fullAttributePath, frames] of Object.entries(selectedKeyframes)) {
            if (frames.length >= 2) {
                var hashIndex = fullAttributePath.indexOf('#');
                if (hashIndex === -1) continue;
                
                var dotAfterHash = fullAttributePath.indexOf('.', hashIndex);
                if (dotAfterHash === -1) continue;
                
                var layerId = fullAttributePath.substring(0, dotAfterHash);
                var attrId = fullAttributePath.substring(dotAfterHash + 1);
                
                var sortedFrames = frames.sort((a, b) => a - b);
                var attributeKeyframeIds = keyframeIdsForFrames(layerId, attrId, sortedFrames);

                if (attributeKeyframeIds.length >= 2 && attributeKeyframeIds.every(Boolean)) {
                    attributeGroups[fullAttributePath] = {
                        layerId: layerId,
                        attrId: attrId,
                        frames: sortedFrames,
                        keyframeIds: attributeKeyframeIds
                    };
                }
            }
        }
        
        if (Object.keys(attributeGroups).length === 0) {
            console.log("Error: No valid attribute groups found with 2+ keyframes");
            return false;
        }
        
        var totalProcessed = 0;
        var currentFrameTime = api.getFrame();
        var velocityApplied = new Set();

        // Pass 0: clear stale speed + influence off position channels that are no longer
        // motion paths, otherwise Cavalry keeps evaluating them by speed and the handles the
        // passes below write are ignored. Runs first because recreating a keyframe changes
        // its id, which would strand the ids the passes iterate.
        for (let [orphanPath, orphanGroup] of Object.entries(attributeGroups)) {
            try {
                if (repairOrphanedVelocitySegments(orphanGroup)) {
                    orphanGroup.keyframeIds = keyframeIdsForFrames(
                        orphanGroup.layerId, orphanGroup.attrId, orphanGroup.frames
                    );
                }
            } catch (orphanError) {
                console.log('Error repairing orphaned velocity for ' + orphanPath + ':', orphanError.message);
            }
        }
        // A repair that could not re-resolve every id would make the passes below write to
        // nothing, so drop those groups rather than half-applying them.
        for (let [checkPath, checkGroup] of Object.entries(attributeGroups)) {
            if (!checkGroup.keyframeIds.every(Boolean)) {
                console.log('Skipping ' + checkPath + ': keyframes could not be re-resolved after repair');
                delete attributeGroups[checkPath];
            }
        }

        // Pass 1: motion path segments use setKeyframeVelocity (both axes); avoids modifyKeyframeTangent on paths
        for (let [attributePath, group] of Object.entries(attributeGroups)) {
            try {
                var isPositionAttr = group.attrId === 'position.x' || group.attrId === 'position.y';
                if (!isPositionAttr) {
                    continue;
                }
                var siblingSetForVelocity = getSiblingKeyframeTimesSet(group.layerId, group.attrId);
                if (!siblingSetForVelocity) {
                    continue;
                }
                var motionRuns = findMotionPathRuns(group, siblingSetForVelocity);
                for (var r = 0; r < motionRuns.length; r++) {
                    var runStart = motionRuns[r].start;
                    var runEnd = motionRuns[r].end;
                    var skipRun = true;
                    for (var fi = runStart; fi <= runEnd; fi++) {
                        if (!velocityApplied.has(velocityRunKey(group.layerId, group.frames[fi]))) {
                            skipRun = false;
                            break;
                        }
                    }
                    if (skipRun) {
                        continue;
                    }
                    var idsSlice = group.keyframeIds.slice(runStart, runEnd + 1);
                    var framesSlice = group.frames.slice(runStart, runEnd + 1);
                    applyVelocityToMotionPathGroup(group.layerId, idsSlice, framesSlice, currentEasing);
                    for (var fj = runStart; fj <= runEnd; fj++) {
                        velocityApplied.add(velocityRunKey(group.layerId, group.frames[fj]));
                    }
                }
            } catch (velocityGroupError) {
                console.log('Error applying motion path velocity for ' + attributePath + ':', velocityGroupError.message);
            }
        }

        // Pass 2: standard tangent easing per pair (skip pairs that are motion path segments)
        for (let [attributePath, group] of Object.entries(attributeGroups)) {
            try {
                var siblingSetForTangent = getSiblingKeyframeTimesSet(group.layerId, group.attrId);

                for (var i = 0; i < group.keyframeIds.length - 1; i++) {
                    var currentKeyId = group.keyframeIds[i];
                    var nextKeyId = group.keyframeIds[i + 1];

                    var currentFrame = group.frames[i];
                    var nextFrame = group.frames[i + 1];
                    var frameDiff = nextFrame - currentFrame;

                    if (siblingSetForTangent && isMotionPathPair(siblingSetForTangent, currentFrame, nextFrame)) {
                        continue;
                    }

                    unlockKeyframePair(
                        currentKeyId,
                        nextKeyId,
                        currentFrame,
                        nextFrame,
                        group.attrId,
                        group.layerId
                    );

                    api.setFrame(currentFrame);
                    var currentValue = api.get(group.layerId, group.attrId);
                    api.setFrame(nextFrame);
                    var nextValue = api.get(group.layerId, group.attrId);

                    if (_clampHoldsEnabled && valuesAreIdentical(currentValue, nextValue)) {
                        flattenHandlesBetweenPair(group.layerId, group.attrId, currentFrame, nextFrame);
                        totalProcessed++;
                        continue;
                    }

                    var valueDiff = nextValue - currentValue;

                    var cavalryHandles = cubicBezierToCavalry(
                        currentEasing.x1,
                        currentEasing.y1,
                        currentEasing.x2,
                        currentEasing.y2,
                        frameDiff,
                        valueDiff
                    );

                    var currentKeyData = api.get(currentKeyId, 'data');
                    var nextKeyData = api.get(nextKeyId, 'data');

                    applyEasingToKeyframePair(
                        currentKeyId,
                        nextKeyId,
                        currentKeyData,
                        nextKeyData,
                        cavalryHandles,
                        group.attrId,
                        group.layerId,
                        currentFrame,
                        currentValue,
                        nextFrame,
                        nextValue
                    );

                    totalProcessed++;
                }
            } catch (groupError) {
                console.log('Error processing attribute ' + attributePath + ':', groupError.message);
            }
        }
        
        api.setFrame(currentFrameTime);
        return true;
        
    } catch (error) {
        console.log("Error applying easing to keyframes:", error.message);
        return false;
    }
}

/**
 * Standalone command: flatten motion path handles between consecutive keyframes with identical values.
 * Works on any selected keyframes regardless of the clamp preference setting.
 * @returns {boolean} Success status
 */
export function fixHoldPaths() {
    try {
        var selectedKeyframes = api.getSelectedKeyframes();
        var keyframeIds = api.getSelectedKeyframeIds();

        if (keyframeIds.length < 2) {
            console.log("Fix Holds: Select at least 2 keyframes");
            return false;
        }

        var attributeGroups = {};
        for (let [fullAttributePath, frames] of Object.entries(selectedKeyframes)) {
            if (frames.length < 2) continue;
            var hashIndex = fullAttributePath.indexOf('#');
            if (hashIndex === -1) continue;
            var dotAfterHash = fullAttributePath.indexOf('.', hashIndex);
            if (dotAfterHash === -1) continue;

            var layerId = fullAttributePath.substring(0, dotAfterHash);
            var attrId = fullAttributePath.substring(dotAfterHash + 1);

            var sortedFrames = frames.sort(function (a, b) { return a - b; });
            var attributeKeyframeIds = keyframeIdsForFrames(layerId, attrId, sortedFrames);
            if (attributeKeyframeIds.length >= 2 && attributeKeyframeIds.every(Boolean)) {
                attributeGroups[fullAttributePath] = {
                    layerId: layerId,
                    attrId: attrId,
                    frames: sortedFrames,
                    keyframeIds: attributeKeyframeIds
                };
            }
        }

        var fixedCount = 0;
        var savedFrame = api.getFrame();
        var velocityFixed = new Set();

        for (let [attributePath, group] of Object.entries(attributeGroups)) {
            var siblingTimes = getSiblingKeyframeTimesSet(group.layerId, group.attrId);

            for (var j = 0; j < group.frames.length - 1; j++) {
                var frameA = group.frames[j];
                var frameB = group.frames[j + 1];

                api.setFrame(frameA);
                var valA = api.get(group.layerId, group.attrId);
                api.setFrame(frameB);
                var valB = api.get(group.layerId, group.attrId);

                if (!valuesAreIdentical(valA, valB)) {
                    continue;
                }

                var isPath = siblingTimes && isMotionPathPair(siblingTimes, frameA, frameB);

                if (isPath) {
                    var siblingAttr = group.attrId === 'position.x' ? 'position.y' : 'position.x';
                    api.setFrame(frameA);
                    var sibValA = api.get(group.layerId, siblingAttr);
                    api.setFrame(frameB);
                    var sibValB = api.get(group.layerId, siblingAttr);

                    if (!valuesAreIdentical(sibValA, sibValB)) {
                        continue;
                    }

                    var keyA = velocityRunKey(group.layerId, frameA);
                    var keyB = velocityRunKey(group.layerId, frameB);
                    if (!velocityFixed.has(keyA) || !velocityFixed.has(keyB)) {
                        var kfIdA = group.keyframeIds[j];
                        var kfIdB = group.keyframeIds[j + 1];

                        flattenHandlesBetweenPair(group.layerId, 'position.x', frameA, frameB);
                        flattenHandlesBetweenPair(group.layerId, 'position.y', frameA, frameB);

                        var kdA = api.get(kfIdA, 'data') || {};
                        var kdB = api.get(kfIdB, 'data') || {};

                        try {
                            api.setKeyframeVelocity(group.layerId, {
                                'position.x': {
                                    frame: frameA,
                                    leftSpeed: kdA.leftSpeed !== undefined ? kdA.leftSpeed : DEFAULT_LEFT_SPEED,
                                    leftInfluence: kdA.leftInfluence !== undefined ? kdA.leftInfluence : DEFAULT_LEFT_INFLUENCE,
                                    rightSpeed: 0,
                                    rightInfluence: DEFAULT_RIGHT_INFLUENCE
                                },
                                'position.y': {
                                    frame: frameA,
                                    leftSpeed: kdA.leftSpeed !== undefined ? kdA.leftSpeed : DEFAULT_LEFT_SPEED,
                                    leftInfluence: kdA.leftInfluence !== undefined ? kdA.leftInfluence : DEFAULT_LEFT_INFLUENCE,
                                    rightSpeed: 0,
                                    rightInfluence: DEFAULT_RIGHT_INFLUENCE
                                }
                            });
                        } catch (e) {}
                        try {
                            api.setKeyframeVelocity(group.layerId, {
                                'position.x': {
                                    frame: frameB,
                                    leftSpeed: 0,
                                    leftInfluence: DEFAULT_LEFT_INFLUENCE,
                                    rightSpeed: kdB.rightSpeed !== undefined ? kdB.rightSpeed : DEFAULT_RIGHT_SPEED,
                                    rightInfluence: kdB.rightInfluence !== undefined ? kdB.rightInfluence : DEFAULT_RIGHT_INFLUENCE
                                },
                                'position.y': {
                                    frame: frameB,
                                    leftSpeed: 0,
                                    leftInfluence: DEFAULT_LEFT_INFLUENCE,
                                    rightSpeed: kdB.rightSpeed !== undefined ? kdB.rightSpeed : DEFAULT_RIGHT_SPEED,
                                    rightInfluence: kdB.rightInfluence !== undefined ? kdB.rightInfluence : DEFAULT_RIGHT_INFLUENCE
                                }
                            });
                        } catch (e) {}
                        velocityFixed.add(keyA);
                        velocityFixed.add(keyB);
                        fixedCount++;
                    }
                } else {
                    flattenHandlesBetweenPair(group.layerId, group.attrId, frameA, frameB);
                    fixedCount++;
                }
            }
        }

        api.setFrame(savedFrame);

        if (fixedCount > 0) {
            console.log("Fixed " + fixedCount + " hold segment(s)");
        } else {
            console.log("No identical-value pairs found to fix");
        }
        return true;
    } catch (error) {
        console.log("Fix holds error:", error.message);
        return false;
    }
}

/**
 * Get keyframe data and extract bezier information for 2 selected keyframes
 * @returns {Object|null} Keyframe info object or null on error
 */
export function getKeyframeInfo() {
    var selectedKeyframes = api.getSelectedKeyframes();
    var keyframeIds = api.getSelectedKeyframeIds();
    
    if (keyframeIds.length !== 2) {
        console.error("Error: Please select exactly 2 keyframes");
        return null;
    }
    
    try {
        var attrPath = api.getAttributeFromKeyframeId(keyframeIds[0]);
        var attrPath2 = api.getAttributeFromKeyframeId(keyframeIds[1]);
        
        if (attrPath !== attrPath2) {
            console.error("Error: Both keyframes must be on the same attribute");
            return null;
        }
        
        var layerId, attrId, selectedFrames;
        var fullAttributePath = null;
        
        for (let [key, frames] of Object.entries(selectedKeyframes)) {
            if (frames.length === 2) {
                fullAttributePath = key;
                selectedFrames = frames.sort((a, b) => a - b);
                break;
            }
        }
        
        if (!fullAttributePath) {
            console.error("Error: Could not find attribute with 2 selected keyframes");
            return null;
        }
        
        var hashIndex = fullAttributePath.indexOf('#');
        if (hashIndex === -1) {
            console.error("Error: Invalid layer ID format in: " + fullAttributePath);
            return null;
        }
        
        var dotAfterHash = fullAttributePath.indexOf('.', hashIndex);
        if (dotAfterHash === -1) {
            console.error("Error: Could not parse attribute from: " + fullAttributePath);
            return null;
        }
        
        layerId = fullAttributePath.substring(0, dotAfterHash);
        attrId = fullAttributePath.substring(dotAfterHash + 1);
        
        if (selectedFrames.length !== 2) {
            console.error("Error: Could not find 2 selected frames");
            return null;
        }
        
        var firstFrame = selectedFrames[0];
        var secondFrame = selectedFrames[1];
        
        var currentFrame = api.getFrame();
        
        var firstValue, secondValue;
        try {
            api.setFrame(firstFrame);
            firstValue = api.get(layerId, attrId);
            
            api.setFrame(secondFrame);
            secondValue = api.get(layerId, attrId);
            
            api.setFrame(currentFrame);
        } catch (e) {
            api.setFrame(currentFrame);
            console.error("Error getting keyframe values: " + e.message);
            return null;
        }
        
        var easingValues = null;
        
        try {
            var firstKeyData = api.get(keyframeIds[0], 'data');
            var secondKeyData = api.get(keyframeIds[1], 'data');
            
            var kf1Data = api.get(keyframeIds[0], 'data');
            var kf2Data = api.get(keyframeIds[1], 'data');
            
            var frameZeroData, frameEndData;
            
            if (Math.abs(kf1Data.numValue - firstValue) < 0.1) {
                frameZeroData = kf1Data;
                frameEndData = kf2Data;
            } else {
                frameZeroData = kf2Data;
                frameEndData = kf1Data;
            }
            
            var outHandleX = null, outHandleY = null;
            var inHandleX = null, inHandleY = null;
            
            if (frameZeroData && frameZeroData.rightBez) {
                outHandleX = frameZeroData.rightBez.x;
                outHandleY = frameZeroData.rightBez.y;
            }
            
            if (frameEndData && frameEndData.leftBez) {
                inHandleX = frameEndData.leftBez.x;
                inHandleY = frameEndData.leftBez.y;
            }
            
            if (outHandleX !== null && inHandleX !== null) {
                var frameDiff = secondFrame - firstFrame;
                var valueDiff = secondValue - firstValue;
                
                if (frameDiff > 0) {
                    var x1 = outHandleX / frameDiff;
                    var y1 = 0;
                    if (Math.abs(valueDiff) > 0.001) {
                        y1 = outHandleY / valueDiff;
                    }
                    
                    var x2 = (frameDiff + inHandleX) / frameDiff;
                    var y2 = 1;
                    if (Math.abs(valueDiff) > 0.001) {
                        y2 = 1 + (inHandleY / valueDiff);
                    }
                    
                    x1 = Math.max(0, Math.min(1, x1));
                    x2 = Math.max(0, Math.min(1, x2));
                    
                    easingValues = x1.toFixed(3) + "," + y1.toFixed(3) + "," + x2.toFixed(3) + "," + y2.toFixed(3);
                }
            }
            
            if (!easingValues) {
                console.error("Could not extract bezier data from keyframes");
                return null;
            }
            
        } catch (e) {
            console.error("Error extracting bezier data:", e.message);
            return null;
        }
        
        var frameRate = getCompositionFrameRate();
        var frameDuration = secondFrame - firstFrame;
        var durationMs = framesToMilliseconds(frameDuration, frameRate);
        
        var propertyName = attrId;
        propertyName = propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
        propertyName = propertyName.replace(/([A-Z])/g, ' $1').trim();
        
        function formatValue(value) {
            if (typeof value === 'number') {
                return Math.round(value * 100) / 100;
            }
            return value;
        }
        
        var formattedStartValue = formatValue(firstValue);
        var formattedEndValue = formatValue(secondValue);
        
        return {
            easing: easingValues,
            duration: durationMs,
            frameDuration: frameDuration,
            propertyName: propertyName,
            startValue: formattedStartValue,
            endValue: formattedEndValue,
            layerId: layerId,
            attrId: attrId,
            firstFrame: firstFrame,
            secondFrame: secondFrame,
            frameRate: frameRate
        };
        
    } catch (error) {
        console.error("Overall error:", error.message);
        return null;
    }
}

/**
 * Copy keyframe duration to clipboard
 */
export function copyKeyframeDuration() {
    try {
        var info = getKeyframeInfo();
        if (info) {
            var durationText = info.propertyName + ": " + info.duration + "ms (" + info.frameDuration + " frames @ " + getCompositionFrameRate() + "fps)";
            api.setClipboardText(durationText);
            console.log("Copied duration: " + durationText);
        }
    } catch (e) {
        console.error("Duration copy error:", e.message);
    }
}

/**
 * Copy keyframe values to clipboard
 */
export function copyKeyframeValues() {
    try {
        var info = getKeyframeInfo();
        if (info) {
            var valuesText = info.propertyName + " " + info.startValue + " > " + info.endValue;
            api.setClipboardText(valuesText);
            console.log("Copied values: " + valuesText);
        }
    } catch (e) {
        console.error("Values copy error:", e.message);
    }
}

/**
 * Copy all keyframe info to clipboard
 */
export function copyAllKeyframeInfo() {
    try {
        var info = getKeyframeInfo();
        if (info) {
            var allText = info.propertyName + "\n" + info.startValue + " > " + info.endValue + "\n" + "cubic-bezier(" + info.easing + ")" + "\n" +
                         "Duration: " + info.duration + "ms (" + info.frameDuration + " frames @ " + getCompositionFrameRate() + "fps)";
            api.setClipboardText(allText);
            console.log("Copied all keyframe info to clipboard");
        }
    } catch (e) {
        console.error("All info copy error:", e.message);
    }
}
