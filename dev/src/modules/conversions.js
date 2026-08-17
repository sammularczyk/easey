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
 * Convert speed values to cubic-bezier
 * @param {number} outInfluence - Outgoing influence (0-100 percentage)
 * @param {number} inInfluence - Incoming influence (0-100 percentage)
 * @param {number} outSpeedY - Outgoing speed Y intensity (0-1 range)
 * @param {number} inSpeedY - Incoming speed Y intensity (0-1 range)
 * @returns {Object} Cubic bezier values {x1, y1, x2, y2}
 */
export function speedToCubicBezier(outInfluence, inInfluence, outSpeedY, inSpeedY) {
    return {
        x1: outInfluence / 100,
        y1: outSpeedY,                    // Left handle Y maps directly to y1
        x2: 1 - (inInfluence / 100),
        y2: 1 - inSpeedY                  // Right handle Y is inverted
    };
}

/**
 * Convert cubic-bezier to speed values
 * @param {number} x1 - First control point X
 * @param {number} y1 - First control point Y
 * @param {number} x2 - Second control point X
 * @param {number} y2 - Second control point Y
 * @returns {Object} Speed values {outInfluence, inInfluence, outSpeedY, inSpeedY}
 */
export function cubicBezierToSpeed(x1, y1, x2, y2) {
    return {
        outInfluence: x1 * 100,
        inInfluence: (1 - x2) * 100,
        outSpeedY: y1,                    // y1 maps directly to left handle Y
        inSpeedY: 1 - y2                  // y2 is inverted
    };
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
    var maxSpeed = 0;

    // First pass: calculate all speeds and find maximum
    for (var i = 0; i <= sampleCount; i++) {
        var t = i / sampleCount;
        var speed = calculateVelocityAtTime(t, x1, y1, x2, y2);
        samples.push(speed);
        maxSpeed = Math.max(maxSpeed, speed);
    }

    // Second pass: normalize to 0-1 range
    if (maxSpeed < 0.0001) maxSpeed = 1;

    for (var j = 0; j < samples.length; j++) {
        samples[j] = samples[j] / maxSpeed;
    }

    return { samples: samples, max: maxSpeed };
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
