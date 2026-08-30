// Bezier conversion utilities
// Functions for converting between cubic-bezier format and Cavalry's internal format

/**
 * Get composition frame rate from the active composition
 * @returns {number} Frame rate of the active composition
 * @throws {Error} If frame rate cannot be retrieved or is invalid
 */
export function getCompositionFrameRate() {
    try {
        var activeCompId = api.getActiveComp();
        var frameRate = api.get(activeCompId, "fps");
        
        if (frameRate === undefined || frameRate === null || typeof frameRate !== 'number' || frameRate <= 0) {
            throw new Error("Invalid frame rate value: " + frameRate);
        }
        
        return frameRate;
    } catch (e) {
        throw new Error("Failed to get composition frame rate: " + e.message);
    }
}

/**
 * Convert cubic bezier to Cavalry format
 * @param {number} x1 - First control point X (0-1)
 * @param {number} y1 - First control point Y
 * @param {number} x2 - Second control point X (0-1)
 * @param {number} y2 - Second control point Y
 * @param {number} frameDiff - Frame difference between keyframes
 * @param {number} valueDiff - Value difference between keyframes
 * @returns {Object} Cavalry handle values {outHandleX, outHandleY, inHandleX, inHandleY}
 */
export function cubicBezierToCavalry(x1, y1, x2, y2, frameDiff, valueDiff) {
    var outHandleX = x1 * frameDiff;
    var outHandleY = y1 * valueDiff;
    var inHandleX = (x2 - 1) * frameDiff;
    var inHandleY = (y2 - 1) * valueDiff;
    
    return {
        outHandleX: outHandleX,
        outHandleY: outHandleY,
        inHandleX: inHandleX,
        inHandleY: inHandleY
    };
}

/**
 * Convert Cavalry format to cubic bezier
 * @param {number} outHandleX - Outgoing handle X offset
 * @param {number} outHandleY - Outgoing handle Y offset
 * @param {number} inHandleX - Incoming handle X offset (negative)
 * @param {number} inHandleY - Incoming handle Y offset (negative)
 * @param {number} frameDiff - Frame difference between keyframes
 * @param {number} valueDiff - Value difference between keyframes
 * @returns {Object} Cubic bezier values {x1, y1, x2, y2}
 */
export function cavalryToCubicBezier(outHandleX, outHandleY, inHandleX, inHandleY, frameDiff, valueDiff) {
    var x1 = outHandleX / frameDiff;
    var y1 = Math.abs(valueDiff) > 0.001 ? outHandleY / valueDiff : 0;
    var x2 = (frameDiff + inHandleX) / frameDiff;
    var y2 = Math.abs(valueDiff) > 0.001 ? 1 + (inHandleY / valueDiff) : 1;
    
    return {
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2
    };
}

/**
 * Convert normalized cubic-bezier to Cavalry motion-path velocity (speed + influence).
 * Maps to setKeyframeVelocity: right* = outgoing from start key, left* = incoming at end key.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {{ rightSpeed: number, rightInfluence: number, leftSpeed: number, leftInfluence: number }}
 */
export function cubicBezierToVelocity(x1, y1, x2, y2, frameDiff) {
    // Measured against Cavalry: influence is clamped to [0.01, 1] and negative speed to 0,
    // but speed has no upper bound (10 stores and animates fine). Capping it here flattened
    // every snappy curve — Ease Out Expo alone needs speed 6.25.
    //
    // The floor is also frame-rate bound. Influence is a fraction of the segment, so an
    // influence below 1/frameDiff describes a ramp narrower than one frame: Cavalry has no
    // sample inside it and crushes the whole ramp into the final frame as a jump. Measured on
    // a 70-frame segment, x2 = 0.991 (influence 0.009 = 0.63 frames) moved 32% of the path in
    // one frame. Rounding up to one frame removes the jump entirely.
    var MIN_INFLUENCE = Math.max(0.01, frameDiff > 0 ? 1 / frameDiff : 0);
    var MAX_INFLUENCE = 1.0;
    var MIN_SPEED = 0.0;
    var EPS = 0.0001;

    var nx1 = Math.max(0, Math.min(1, x1));
    var nx2 = Math.max(0, Math.min(1, x2));

    var rightInfluence = Math.max(MIN_INFLUENCE, Math.min(MAX_INFLUENCE, nx1));
    var leftInfluence = Math.max(MIN_INFLUENCE, Math.min(MAX_INFLUENCE, 1 - nx2));

    // Speed comes off the CLAMPED influence, so the control point keeps its y and only slides
    // in x. Dividing by the raw influence instead would move the point diagonally and change
    // how hard the curve eases, not just where it turns.
    var rightSpeed = MIN_SPEED;
    if (rightInfluence > EPS) {
        var rs = y1 / rightInfluence;
        if (isFinite(rs)) {
            rightSpeed = Math.max(MIN_SPEED, rs);
        }
    }

    var leftSpeed = MIN_SPEED;
    if (leftInfluence > EPS) {
        var ls = (1 - y2) / leftInfluence;
        if (isFinite(ls)) {
            leftSpeed = Math.max(MIN_SPEED, ls);
        }
    }

    return {
        rightSpeed: rightSpeed,
        rightInfluence: rightInfluence,
        leftSpeed: leftSpeed,
        leftInfluence: leftInfluence
    };
}

/**
 * Inverse of cubicBezierToVelocity: rebuild a normalized cubic-bezier from Cavalry's
 * motion-path speed + influence. Use for segments Cavalry evaluates by velocity rather
 * than by bezier handles, where the handles hold nothing useful.
 * @param {number} rightSpeed - outgoing speed at the start keyframe
 * @param {number} rightInfluence - outgoing influence at the start keyframe
 * @param {number} leftSpeed - incoming speed at the end keyframe
 * @param {number} leftInfluence - incoming influence at the end keyframe
 * @returns {Object} Cubic bezier values {x1, y1, x2, y2}
 */
export function velocityToCubicBezier(rightSpeed, rightInfluence, leftSpeed, leftInfluence) {
    return {
        x1: rightInfluence,
        y1: rightSpeed * rightInfluence,
        x2: 1 - leftInfluence,
        y2: 1 - leftSpeed * leftInfluence
    };
}

/**
 * Convert speed-graph handle positions back to a cubic-bezier.
 *
 * Inverse of cubicBezierToSpeed + the graph's normalisation. A handle at height h on a graph
 * whose peak is `scale` means a real slope of h * scale, and a bezier's endpoint slope is
 * y1 / x1 — so y1 = h * scale * x1. Passing the scale in rather than deriving it is what
 * keeps a drag stable: the peak moves as you drag, and a handle measured against a moving
 * ruler chases its own tail. Callers freeze it at drag start.
 *
 * @param {number} outInfluence - Outgoing influence (0-100 percentage)
 * @param {number} inInfluence - Incoming influence (0-100 percentage)
 * @param {number} outSpeedY - Outgoing handle height, as a fraction of the plot (peak = 1)
 * @param {number} inSpeedY - Incoming handle height, as a fraction of the plot
 * @param {number} [scale] - The graph's peak speed in normalized bezier units; 1 if omitted
 * @returns {Object} Cubic bezier values {x1, y1, x2, y2}
 */
export function speedToCubicBezier(outInfluence, inInfluence, outSpeedY, inSpeedY, scale) {
    var peak = (scale > 0) ? scale : 1;
    var x1 = outInfluence / 100;
    var x2 = 1 - (inInfluence / 100);

    return {
        x1: x1,
        y1: outSpeedY * peak * x1,
        x2: x2,
        y2: 1 - inSpeedY * peak * (1 - x2)
    };
}

/**
 * Convert cubic-bezier to speed-graph terms.
 *
 * The speeds returned are real slopes — dValue/dTime in normalized bezier units, which is
 * what the speed graph plots. A bezier's endpoint tangent is 3(P1 - P0), so the slope leaving
 * the first keyframe is y1 / x1: the handle's RISE OVER RUN, not its rise. Reading y1 alone
 * (as this used to) calls a long lazy ramp and a short steep one the same speed, which then
 * has to be papered over when drawing.
 *
 * @param {number} x1 - First control point X
 * @param {number} y1 - First control point Y
 * @param {number} x2 - Second control point X
 * @param {number} y2 - Second control point Y
 * @returns {Object} {outInfluence, inInfluence, outSpeed, inSpeed}
 */
export function cubicBezierToSpeed(x1, y1, x2, y2) {
    return {
        outInfluence: x1 * 100,
        inInfluence: (1 - x2) * 100,
        outSpeed: (x1 > 0) ? y1 / x1 : 0,
        inSpeed: (x2 < 1) ? (1 - y2) / (1 - x2) : 0
    };
}

/**
 * Time fraction reached at parameter t on a normalized cubic bezier — cubic(t) with the
 * endpoints pinned at 0 and 1. Monotone for x1, x2 in [0, 1], so it never folds back.
 */
export function bezierX(t, x1, x2) {
    var m = 1 - t;
    return 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t;
}

/**
 * Calculate velocity (dy/dx) at time t for cubic bezier curve
 * @param {number} t - Time parameter (0-1)
 * @param {number} x1 - First control point X
 * @param {number} y1 - First control point Y
 * @param {number} x2 - Second control point X
 * @param {number} y2 - Second control point Y
 * @returns {number} Velocity at time t
 */
export function calculateVelocityAtTime(t, x1, y1, x2, y2) {
    var oneMinusT = 1 - t;
    
    // Calculate dy/dt (rate of value change over curve parameter)
    var dy = 3 * oneMinusT * oneMinusT * y1 + 
             6 * oneMinusT * t * (y2 - y1) + 
             3 * t * t * (1 - y2);
    
    // Calculate dx/dt (rate of time change over curve parameter)
    var dx = 3 * oneMinusT * oneMinusT * x1 + 
             6 * oneMinusT * t * (x2 - x1) + 
             3 * t * t * (1 - x2);
    
    // Speed is dy/dx (avoid division by zero)
    var speed = Math.abs(dx) > 0.0001 ? Math.abs(dy / dx) : 0;
    
    return speed;
}

/**
 * Sample velocity curve at multiple points and return normalized values
 * @param {number} x1 - First control point X
 * @param {number} y1 - First control point Y
 * @param {number} x2 - Second control point X
 * @param {number} y2 - Second control point Y
 * @param {number} sampleCount - Number of samples to take
 * @returns {number[]} Array of normalized velocity samples (0-1)
 */
export function sampleVelocityCurve(x1, y1, x2, y2, sampleCount) {
    return sampleVelocityCurveWithMax(x1, y1, x2, y2, sampleCount).samples;
}

/**
 * As sampleVelocityCurve, but also returns the peak it divided by.
 *
 * The speed graph normalises each segment against its own peak, so the y axis carries no
 * absolute meaning. Drawing a neighbouring segment beside the selected one needs a shared
 * scale, and that means knowing the divisor rather than throwing it away. The peak is in
 * normalized bezier units — multiply by |valueDiff / frameDiff| for real value-per-frame.
 *
 * @returns {{ samples: number[], max: number }}
 */
export function sampleVelocityCurveWithMax(x1, y1, x2, y2, sampleCount) {
    var samples = [];
    var times = [];
    var maxSpeed = 0;

    // First pass: calculate all speeds and find maximum
    for (var i = 0; i <= sampleCount; i++) {
        var t = i / sampleCount;
        var speed = calculateVelocityAtTime(t, x1, y1, x2, y2);
        samples.push(speed);
        // t is the bezier's PARAMETER, not its time. Plotting sample i at i/sampleCount
        // stretches the speed graph horizontally wherever the easing is steep — the peak of
        // an Ease Out Expo lands a fifth of the plot's width late. x(t) is the sample's real
        // time, so it is what the x axis has to use.
        times.push(bezierX(t, x1, x2));
        maxSpeed = Math.max(maxSpeed, speed);
    }

    // Second pass: normalize to 0-1 range
    if (maxSpeed < 0.0001) maxSpeed = 1;

    for (var j = 0; j < samples.length; j++) {
        samples[j] = samples[j] / maxSpeed;
    }

    return { samples: samples, times: times, max: maxSpeed };
}

/**
 * Control points for a neighbouring segment's curve, in canvas pixels.
 *
 * The graphs map the SELECTED segment onto the plot rect. A neighbour is drawn by extending
 * that same linear map past the plot edges: frames are the shared x axis, values the shared
 * y axis. So a neighbour needs no axis range of its own — only the selected segment's
 * frameDiff and valueDiff, which set the scale.
 *
 * Because the previous segment covers frames before the plot's left edge and the next one
 * frames after its right edge, neither can ever land inside the plot rect, whichever way its
 * values run. Nothing needs clipping: the gutter bounds what is visible and the canvas edge
 * cuts off the rest, which is what the design asks for.
 *
 * ui.Draw is y-up, so `endY` is the plot's BOTTOM and `startY` its top — the same inverted
 * naming drawCurve uses.
 *
 * @param {string} side - "prev" or "next"
 * @param {Object} sel - selected segment {frameDiff, valueDiff}
 * @param {Object} seg - neighbour segment {frameDiff, valueDiff, easing:{x1,y1,x2,y2}}
 * @param {Object} bounds - {startX, startY, endX, endY} plot rectangle
 * @returns {{p0:number[], cp1:number[], cp2:number[], p3:number[]}|null} null if unmappable
 */
export function neighbourCurveControlPoints(side, sel, seg, bounds) {
    if (!sel || !seg || !seg.easing) return null;
    if (!(sel.frameDiff > 0) || Math.abs(sel.valueDiff) < 0.001) return null;
    if (!(seg.frameDiff > 0)) return null;

    var scaleX = (bounds.endX - bounds.startX) / sel.frameDiff;
    var scaleY = (bounds.startY - bounds.endY) / sel.valueDiff;

    var spanX = seg.frameDiff * scaleX;
    var spanY = seg.valueDiff * scaleY;

    // The neighbour is anchored at the shared keyframe — the plot corner it meets — and
    // extends away from the plot. "prev" ends where the selection begins; "next" begins
    // where it ends.
    var originX, originY;
    if (side === "prev") {
        originX = bounds.startX - spanX;
        originY = bounds.endY - spanY;
    } else {
        originX = bounds.endX;
        originY = bounds.startY;
    }

    var e = seg.easing;

    return {
        p0: [originX, originY],
        cp1: [originX + e.x1 * spanX, originY + e.y1 * spanY],
        cp2: [originX + e.x2 * spanX, originY + e.y2 * spanY],
        p3: [originX + spanX, originY + spanY]
    };
}

/**
 * Convert frames to milliseconds
 * @param {number} frames - Number of frames
 * @param {number} frameRate - Frame rate (fps)
 * @returns {number} Duration in milliseconds
 */
export function framesToMilliseconds(frames, frameRate) {
    return Math.round((frames / frameRate) * 1000);
}

/**
 * Rotate one of the selected segment's handles to leave along a neighbour's tangent.
 *
 * A join reads as smooth when the SPEED matches across it, and speed is dValue/dFrame — the
 * slope. A bezier's endpoint tangent is 3(P1 - P0), so slope depends only on the handle's
 * DIRECTION; its length cancels. Matching the angle therefore matches the speed exactly, and
 * the length is free to stay as the user set it. That is why this rotates and never rescales.
 *
 * Ghost points arrive already mapped through the selected segment's own axes (see
 * neighbourCurveControlPoints), so working in pixels here is working in shared value/frame
 * units — no conversion needed.
 *
 * @param {string} side - "prev" rotates the outgoing handle, "next" the incoming one
 * @param {Object} points - the ghost's {p0, cp1, cp2, p3} in canvas pixels
 * @param {Object} bounds - {startX, startY, endX, endY} plot rectangle
 * @param {Object} easing - current {x1, y1, x2, y2}
 * @returns {Object|null} {x1, y1} for "prev" or {x2, y2} for "next"; null if unmappable
 */
export function tangentMatchedHandle(side, points, bounds, easing) {
    if (!points || !bounds || !easing) return null;

    var width = bounds.endX - bounds.startX;
    var height = bounds.startY - bounds.endY;
    if (!(width > 0) || !(height > 0)) return null;

    var cornerX, cornerY, dirX, dirY, handleX, handleY, sign;
    if (side === "prev") {
        // The neighbour's direction of travel as it arrives at the shared keyframe.
        cornerX = bounds.startX;
        cornerY = bounds.endY;
        dirX = points.p3[0] - points.cp2[0];
        dirY = points.p3[1] - points.cp2[1];
        handleX = easing.x1 * width;
        handleY = easing.y1 * height;
        sign = 1;
    } else {
        // The direction it sets off in, leaving the shared keyframe.
        cornerX = bounds.endX;
        cornerY = bounds.startY;
        dirX = points.cp1[0] - points.p0[0];
        dirY = points.cp1[1] - points.p0[1];
        handleX = (1 - easing.x2) * width;
        handleY = (1 - easing.y2) * height;
        sign = -1;
    }

    var dirLength = Math.sqrt(dirX * dirX + dirY * dirY);
    if (!(dirLength > 0)) return null;
    dirX /= dirLength;
    dirY /= dirLength;

    var length = Math.sqrt(handleX * handleX + handleY * handleY);
    // A handle already flattened onto the keyframe has no length worth keeping. A third of
    // the segment is Cavalry's own default influence, so it is the least surprising stand-in.
    if (!(length > 0)) length = width / 3;

    // Time must keep running forwards: x1 and x2 have to stay within the plot or the curve
    // folds back on itself. Shorten the handle rather than bend it — the angle is the point.
    if (dirX > 0) length = Math.min(length, width / dirX);

    var px = cornerX + sign * dirX * length;
    var py = cornerY + sign * dirY * length;

    if (side === "prev") {
        return { x1: (px - bounds.startX) / width, y1: (py - bounds.endY) / height };
    }
    return { x2: (px - bounds.startX) / width, y2: (py - bounds.endY) / height };
}

/**
 * A neighbouring segment's velocity curve, as points on the speed graph.
 *
 * Shared by the renderer and the hit-test so a click lands on the line that was drawn rather
 * than on a second, subtly different reconstruction of it.
 *
 * The speed graph normalises each segment against its own peak, so a neighbour only says
 * something about relative speed once it is measured against the SELECTED segment's peak in
 * real units per frame — hence selPeak. A neighbour genuinely faster than the selection
 * therefore runs off the top and gets clipped, which is the honest reading.
 *
 * @param {string} side - "prev" or "next"
 * @param {Object} sel - selected segment {frameDiff, valueDiff}
 * @param {Object} seg - neighbour {frameDiff, valueDiff, easing}
 * @param {Object} bounds - {startX, startY, endX, endY} plot rectangle
 * @param {number} selPeak - selected segment's peak speed, in value per frame
 * @param {number} sampleCount
 * @returns {{points: Array<Array<number>>, joinHeight: number}|null} joinHeight is the
 *          neighbour's height at the corner it shares with the selection, as a fraction of
 *          the plot height — what the selected curve's endpoint must equal to meet it.
 */
export function speedGhostPolyline(side, sel, seg, bounds, selPeak, sampleCount) {
    if (!sel || !seg || !seg.easing) return null;
    if (!(selPeak > 0) || !(sel.frameDiff > 0) || !(seg.frameDiff > 0)) return null;

    var count = Math.max(2, sampleCount || 24);
    var pxPerFrame = (bounds.endX - bounds.startX) / sel.frameDiff;
    var graphHeight = bounds.startY - bounds.endY;
    var spanX = seg.frameDiff * pxPerFrame;
    var originX = side === "prev" ? bounds.startX - spanX : bounds.endX;

    var sampled = sampleVelocityCurveWithMax(
        Math.min(0.999, Math.max(0.001, seg.easing.x1)),
        seg.easing.y1,
        Math.min(0.999, Math.max(0.001, seg.easing.x2)),
        seg.easing.y2,
        count
    );
    // sampled.samples are divided by this segment's own peak, so multiplying back by it and
    // by the segment's real value-per-frame recovers absolute speed.
    var segScale = sampled.max * Math.abs(seg.valueDiff / seg.frameDiff) / selPeak;

    var points = [];
    for (var s = 0; s <= count; s++) {
        points.push([
            // Real time, not the bezier parameter — see the times comment in the sampler.
            originX + sampled.times[s] * spanX,
            bounds.endY + sampled.samples[s] * segScale * graphHeight
        ]);
    }

    // The shared corner is the neighbour's END for prev, and its START for next.
    var joinIndex = side === "prev" ? count : 0;
    return { points: points, joinHeight: sampled.samples[joinIndex] * segScale };
}
