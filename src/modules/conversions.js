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
    
    for (var i = 0; i < samples.length; i++) {
        samples[i] = samples[i] / maxSpeed;
    }
    
    return samples;
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
