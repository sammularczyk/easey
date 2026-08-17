// Geometry and curve-fitting for motion path easing. Pure maths, no Cavalry calls, so it
// runs under node in test/pathSolve.test.mjs.
//
// The problem these solve: a motion path segment has two independent parts. Its shape is a
// cubic bezier in XY, parameterised by u. Its timing is speed + influence, which maps time
// to u. What the eye reads as easing is DISTANCE over time, and distance is not proportional
// to u — a segment with long handles covers most of its length in the middle of its u range,
// which looks like an ease-out no matter what timing you ask for. So easing the path to match
// a single-value Attribute means pre-warping the timing by the inverse of that distribution.

var ARC_SAMPLES = 512;
var PROJECT_SCAN = 256;
var PROJECT_REFINE = 24;

function cubic(u, a, b, c, d) {
    var m = 1 - u;
    return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d;
}

/**
 * Point on the spatial cubic at parameter u.
 * @param {Array<Array<number>>} P - four [x, y] control points
 */
export function pathPoint(P, u) {
    return [
        cubic(u, P[0][0], P[1][0], P[2][0], P[3][0]),
        cubic(u, P[0][1], P[1][1], P[2][1], P[3][1])
    ];
}

/**
 * Cumulative arc-length table for the spatial cubic. Chord sums at this density are well
 * inside a rendered pixel; the count matters far more than the integration scheme.
 * @returns {{ cumulative: Array<number>, total: number }}
 */
export function buildArcTable(P) {
    var cumulative = [0];
    var previous = pathPoint(P, 0);
    var total = 0;
    for (var i = 1; i <= ARC_SAMPLES; i++) {
        var point = pathPoint(P, i / ARC_SAMPLES);
        total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        cumulative.push(total);
        previous = point;
    }
    return { cumulative: cumulative, total: total };
}

/** Fraction of the path's length reached at parameter u. */
export function arcAt(table, u) {
    if (table.total <= 0) {
        return u;
    }
    var scaled = Math.max(0, Math.min(1, u)) * ARC_SAMPLES;
    var lower = Math.floor(scaled);
    if (lower >= ARC_SAMPLES) {
        return 1;
    }
    var frac = scaled - lower;
    var value = table.cumulative[lower] + (table.cumulative[lower + 1] - table.cumulative[lower]) * frac;
    return value / table.total;
}

/** Parameter u at which the path has covered the given fraction of its length. */
export function arcInverse(table, fraction) {
    var low = 0;
    var high = 1;
    for (var i = 0; i < 40; i++) {
        var mid = (low + high) / 2;
        if (arcAt(table, mid) < fraction) {
            low = mid;
        } else {
            high = mid;
        }
    }
    return (low + high) / 2;
}

/**
 * Parameter u of the point on the path closest to a sampled position. Recovering u this way
 * rather than summing the chords between sampled frames matters: where the layer covers
 * hundreds of units in one frame the chord badly understates the distance actually travelled,
 * and the error is largest exactly where the easing is steepest.
 */
export function projectToPath(P, point) {
    var best = 0;
    var bestDistance = Infinity;
    for (var i = 0; i <= PROJECT_SCAN; i++) {
        var u = i / PROJECT_SCAN;
        var q = pathPoint(P, u);
        var d = (q[0] - point[0]) * (q[0] - point[0]) + (q[1] - point[1]) * (q[1] - point[1]);
        if (d < bestDistance) {
            bestDistance = d;
            best = u;
        }
    }
    var span = 1 / PROJECT_SCAN;
    for (var r = 0; r < PROJECT_REFINE; r++) {
        span /= 2;
        var candidates = [best - span, best + span];
        for (var c = 0; c < 2; c++) {
            var cu = Math.max(0, Math.min(1, candidates[c]));
            var cq = pathPoint(P, cu);
            var cd = (cq[0] - point[0]) * (cq[0] - point[0]) + (cq[1] - point[1]) * (cq[1] - point[1]);
            if (cd < bestDistance) {
                bestDistance = cd;
                best = cu;
            }
        }
    }
    return best;
}

/**
 * The two position channels of a motion path share one clock: the x component of a keyframe's
 * bezier handle is a frame offset, and both channels must carry the same one or each axis
 * interpolates on its own schedule and the composite path develops a corner. Cavalry splits
 * them when a keyframe is deleted — it re-derives the surviving neighbours' tangents per
 * channel, so the two answers disagree (measured: 12 frames apart on symmetric channels, 18.6
 * with a 10x handle imbalance, 127 in a scene that had been edited repeatedly).
 *
 * Returns the shared offset both channels should carry, or null when they already agree and
 * sit inside the segment. Takes the SMALLER magnitude: a handle longer than the segment puts
 * its control point outside the segment's own frame range, which folds that channel's time
 * curve back on itself — the hard kink rather than a gentle drift. Preferring the shorter one
 * also means never inventing a number neither channel had.
 *
 * @param {number} offsetX - the x channel's handle offset in frames (signed)
 * @param {number} offsetY - the y channel's handle offset in frames (signed)
 * @param {number} frameDiff - length of the segment this handle governs, in frames
 * @returns {number|null} the offset to write to both channels, or null if no repair is needed
 */
export function sharedTangentOffset(offsetX, offsetY, frameDiff) {
    if (!isFinite(offsetX) || !isFinite(offsetY) || !(frameDiff > 0)) {
        return null;
    }
    var magnitudeX = Math.abs(offsetX);
    var magnitudeY = Math.abs(offsetY);
    var agree = Math.abs(magnitudeX - magnitudeY) <= TANGENT_MATCH_EPSILON;
    var withinSegment = magnitudeX <= frameDiff && magnitudeY <= frameDiff;
    if (agree && withinSegment) {
        return null;
    }

    var shorter = magnitudeX <= magnitudeY ? offsetX : offsetY;
    var longer = magnitudeX <= magnitudeY ? offsetY : offsetX;

    // Both flat is a legitimate state — a zero-length handle is a linear segment, not damage —
    // and is already handled above. One flat against one with length IS damage, so keep the
    // side that still has length rather than flattening the segment.
    var source = Math.abs(shorter) <= TANGENT_MATCH_EPSILON && Math.abs(longer) > TANGENT_MATCH_EPSILON
        ? longer
        : shorter;

    // Magnitude and sign both come from that one channel, so the repair is always a value one
    // of the two channels actually held, pointing the way it pointed.
    return Math.min(Math.abs(source), frameDiff) * (source < 0 ? -1 : 1);
}

var TANGENT_MATCH_EPSILON = 0.001;

/** Evaluate a normalized cubic-bezier easing at time fraction t. */
export function easeAt(t, x1, y1, x2, y2) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var low = 0;
    var high = 1;
    for (var i = 0; i < 40; i++) {
        var mid = (low + high) / 2;
        if (cubic(mid, 0, x1, x2, 1) < t) {
            low = mid;
        } else {
            high = mid;
        }
    }
    return cubic((low + high) / 2, 0, y1, y2, 1);
}

/**
 * Least-squares fit of a cubic-bezier easing to sampled (t, value) pairs, by coordinate
 * descent with a shrinking step. Deterministic and fast enough to run per segment; a proper
 * simplex buys nothing on four bounded parameters starting from a decent guess.
 *
 * minInfluence bounds x1 and 1 - x2 so the fit can only propose ramps Cavalry can render —
 * see the frame floor in cubicBezierToVelocity.
 *
 * @returns {{ x1: number, y1: number, x2: number, y2: number, rms: number }}
 */
export function fitEase(times, values, minInfluence, seed) {
    var floor = Math.max(0.01, minInfluence || 0.01);
    var p = seed ? [seed.x1, seed.y1, seed.x2, seed.y2] : [0.4, 0.2, 0.6, 0.8];

    function clamp(q) {
        q[0] = Math.max(floor, Math.min(1, q[0]));
        q[2] = Math.max(0, Math.min(1 - floor, q[2]));
        q[1] = Math.max(0, Math.min(4, q[1]));
        q[3] = Math.max(-3, Math.min(1, q[3]));
        return q;
    }

    function cost(q) {
        var sum = 0;
        for (var i = 0; i < times.length; i++) {
            var d = easeAt(times[i], q[0], q[1], q[2], q[3]) - values[i];
            sum += d * d;
        }
        return sum;
    }

    p = clamp(p);
    var best = cost(p);
    var step = 0.25;
    while (step > 1e-5) {
        var improved = false;
        for (var d = 0; d < 4; d++) {
            for (var s = -1; s <= 1; s += 2) {
                var q = clamp(p.slice());
                q[d] += s * step;
                q = clamp(q);
                var c = cost(q);
                if (c < best) {
                    best = c;
                    p = q;
                    improved = true;
                }
            }
        }
        if (!improved) {
            step *= 0.6;
        }
    }
    return { x1: p[0], y1: p[1], x2: p[2], y2: p[3], rms: Math.sqrt(best / times.length) };
}
