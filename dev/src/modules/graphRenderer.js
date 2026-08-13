// Graph rendering module
// Functions for drawing the value curve and speed curve on canvas elements

import { cubicBezierToSpeed, sampleVelocityCurve } from './conversions.js';
import { getTokens, blend } from './theme.js';

var DEFAULT_HANDLE_RADIUS = 6;

// The design's handle is a green disc with a 2px white ring inset flush to its
// edge, over a drop shadow of dy=4, gaussian blur sigma=2, black at 25%.
//
// ui.Draw's paint object is only {color, stroke, strokeWidth} — no shadow, blur
// or opacity — so that shadow is approximated by stacked opaque discs, each
// pre-blended toward the plot background. Discs are opaque, so a point takes
// the colour of the *smallest* disc covering it: the list runs widest-and-
// faintest to tightest-and-darkest, and the darkest matches the design's 25%.
// On a flat background the result is indistinguishable from real alpha, and it
// avoids depending on 8-digit hex, which the ui.Draw docs never cover.
// ponytail: if alpha in a Draw paint ever turns out to work, only shadowColor()
// needs to change.
//
// grow and mix are the tuning knob: grow is px added to the handle radius, mix
// is 0..1 toward black.
var SHADOW_RINGS = [
    { grow: 4, mix: 0.06 },
    { grow: 2.5, mix: 0.13 },
    { grow: 1, mix: 0.20 },
    { grow: 0, mix: 0.25 }
];
// Negative offsets the shadow upward. The design casts it down (dy=4); up reads
// better against these graphs, where handles usually sit above their lines.
var SHADOW_OFFSET_Y = -4;

// White ring: 2px wide, its outer edge flush with the handle's, so it is drawn
// as a stroke one unit inside the handle radius.
var RING_WIDTH = 2;

// How much a handle grows while the cursor is over it.
var HOVER_GROW = 1.5;

function shadowColor(plotBg, mix) {
    return blend(plotBg, "#000000", mix);
}

/**
 * Handle radius, grown when this handle is the hovered one.
 * @param {string} key - Handle key, matching config.hoveredHandle
 * @param {string|null} hoveredHandle - Currently hovered handle key
 * @param {number} radius - Base handle radius
 * @returns {number}
 */
function hoverRadius(key, hoveredHandle, radius) {
    return hoveredHandle === key ? radius + HOVER_GROW : radius;
}

/**
 * Draw a control handle: drop shadow, filled disc, then the outline ring.
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {number} x - Handle centre X
 * @param {number} y - Handle centre Y
 * @param {number} radius - Handle radius
 * @param {Object} tokens - Theme tokens
 */
function drawHandle(canvas, x, y, radius, tokens) {
    for (var i = 0; i < SHADOW_RINGS.length; i++) {
        var ring = SHADOW_RINGS[i];
        var shadowPath = new cavalry.Path();
        shadowPath.addEllipse(x, y + SHADOW_OFFSET_Y, radius + ring.grow, radius + ring.grow);
        canvas.addPath(shadowPath.toObject(), {
            "color": shadowColor(tokens.plotBg, ring.mix),
            "stroke": false
        });
    }

    var handlePath = new cavalry.Path();
    handlePath.addEllipse(x, y, radius, radius);
    canvas.addPath(handlePath.toObject(), { "color": tokens.accent, "stroke": false });

    // Tracks the text colour rather than a literal white, so the ring stays a
    // contrasting outline on a light theme instead of vanishing.
    var ringPath = new cavalry.Path();
    ringPath.addEllipse(x, y, radius - RING_WIDTH / 2, radius - RING_WIDTH / 2);
    canvas.addPath(ringPath.toObject(), {
        "color": tokens.text,
        "stroke": true,
        "strokeWidth": RING_WIDTH
    });
}

/**
 * Draw the plot grid and its surrounding border.
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} bounds - {startX, startY, endX, endY} plot rectangle
 * @param {Object} tokens - Theme tokens
 */
function drawGrid(canvas, bounds, tokens) {
    var gridPath = new cavalry.Path();

    for (var i = 0; i <= 10; i++) {
        var x = bounds.startX + (i * (bounds.endX - bounds.startX) / 10);
        gridPath.moveTo(x, bounds.endY);
        gridPath.lineTo(x, bounds.startY);
    }
    for (var j = 0; j <= 10; j++) {
        var y = bounds.endY + (j * (bounds.startY - bounds.endY) / 10);
        gridPath.moveTo(bounds.startX, y);
        gridPath.lineTo(bounds.endX, y);
    }

    canvas.addPath(gridPath.toObject(), {
        "color": tokens.grid,
        "stroke": true,
        "strokeWidth": 1
    });

    var borderPath = new cavalry.Path();
    borderPath.addRect(bounds.startX, bounds.endY, bounds.endX, bounds.startY);
    canvas.addPath(borderPath.toObject(), {
        "color": tokens.grid,
        "stroke": true,
        "strokeWidth": 1
    });
}

/**
 * Draw the value (bezier) curve on the canvas
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} currentEasing - Current easing values {x1, y1, x2, y2}
 * @param {Object} config - Graph configuration {width, height, padding, handleRadius}
 */
export function drawCurve(canvas, currentEasing, config) {
    // Clear all paths
    canvas.clearPaths();

    var tokens = getTokens();
    var width = config.width;
    var height = config.height;
    var padding = config.padding;
    var handleRadius = config.handleRadius || DEFAULT_HANDLE_RADIUS;

    // Set background color
    canvas.setBackgroundColor(tokens.plotBg);

    var startX = padding;
    var startY = height - padding;
    var endX = width - padding;
    var endY = padding;

    drawGrid(canvas, { startX: startX, startY: startY, endX: endX, endY: endY }, tokens);

    // Create bezier curve path
    var curvePath = new cavalry.Path();

    // Ensure currentEasing has valid values
    var x1 = (currentEasing.x1 !== undefined) ? currentEasing.x1 : 0.25;
    var y1 = (currentEasing.y1 !== undefined) ? currentEasing.y1 : 0.1;
    var x2 = (currentEasing.x2 !== undefined) ? currentEasing.x2 : 0.25;
    var y2 = (currentEasing.y2 !== undefined) ? currentEasing.y2 : 1.0;

    // Control points - both handles positioned correctly for easing curve
    var cp1X = startX + x1 * (endX - startX);
    var cp1Y = endY + y1 * (startY - endY);
    var cp2X = startX + x2 * (endX - startX);
    var cp2Y = endY + y2 * (startY - endY);

    // Clamp handle positions for drawing (so they stay visible)
    var visibleCp1X = Math.max(startX - 20, Math.min(endX + 20, cp1X));
    var visibleCp1Y = Math.max(endY - 20, Math.min(startY + 20, cp1Y));
    var visibleCp2X = Math.max(startX - 20, Math.min(endX + 20, cp2X));
    var visibleCp2Y = Math.max(endY - 20, Math.min(startY + 20, cp2Y));

    // Draw the bezier curve (from bottom-left to top-right)
    curvePath.moveTo(startX, endY);
    curvePath.cubicTo(cp1X, cp1Y, cp2X, cp2Y, endX, startY);

    var curvePaint = {"color": tokens.curve, "stroke": true, "strokeWidth": 2};
    if (curvePath && curvePath.toObject) {
        canvas.addPath(curvePath.toObject(), curvePaint);
    }

    // Create control lines (use visible positions for drawing). Added before the
    // handles so the handles and their shadows sit on top.
    var controlPath = new cavalry.Path();
    controlPath.moveTo(startX, endY);
    controlPath.lineTo(visibleCp1X, visibleCp1Y);
    controlPath.moveTo(endX, startY);
    controlPath.lineTo(visibleCp2X, visibleCp2Y);

    var controlPaint = {"color": tokens.accent, "stroke": true, "strokeWidth": 2};
    if (controlPath && controlPath.toObject) {
        canvas.addPath(controlPath.toObject(), controlPaint);
    }

    // Create control handles (use visible positions for drawing)
    drawHandle(canvas, visibleCp1X, visibleCp1Y, hoverRadius('cp1', config.hoveredHandle, handleRadius), tokens);
    drawHandle(canvas, visibleCp2X, visibleCp2Y, hoverRadius('cp2', config.hoveredHandle, handleRadius), tokens);

    // Trigger redraw
    canvas.redraw();
}

/**
 * Draw the speed curve on the speed graph canvas (velocity-based)
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} currentEasing - Current easing values {x1, y1, x2, y2}
 * @param {Object} speedEasing - Speed easing state to update
 * @param {Object} config - Graph configuration {width, height, padding, handleRadius}
 */
export function drawSpeedCurve(canvas, currentEasing, speedEasing, config) {
    // Always sync speedEasing from currentEasing before drawing
    var speed = cubicBezierToSpeed(currentEasing.x1, currentEasing.y1, currentEasing.x2, currentEasing.y2);
    speedEasing.outInfluence = speed.outInfluence;
    speedEasing.inInfluence = speed.inInfluence;
    speedEasing.outSpeedY = speed.outSpeedY;
    speedEasing.inSpeedY = speed.inSpeedY;

    canvas.clearPaths();

    var tokens = getTokens();
    var width = config.width;
    var height = config.height;
    var padding = config.padding;
    var handleRadius = config.handleRadius || DEFAULT_HANDLE_RADIUS;

    canvas.setBackgroundColor(tokens.plotBg);

    // Graph coordinates
    var startX = padding;
    var startY = height - padding;
    var endX = width - padding;
    var endY = padding;
    var midX = startX + (endX - startX) / 2;

    drawGrid(canvas, { startX: startX, startY: startY, endX: endX, endY: endY }, tokens);

    // Get current cubic-bezier values
    var x1 = currentEasing.x1;
    var y1 = currentEasing.y1;
    var x2 = currentEasing.x2;
    var y2 = currentEasing.y2;

    // Clamp x values for velocity calculation
    var x1Clamped = Math.min(0.999, Math.max(0.001, x1));
    var x2Clamped = Math.min(0.999, Math.max(0.001, x2));

    var graphHeight = startY - endY;

    // Calculate handle positions
    var outHandleX = startX + (speedEasing.outInfluence / 100) * (midX - startX);
    var inHandleX = endX - (speedEasing.inInfluence / 100) * (endX - midX);
    var outHandleY = endY + (speedEasing.outSpeedY * graphHeight);
    var inHandleY = endY + (speedEasing.inSpeedY * graphHeight);

    // Sample velocity curve
    var sampleCount = 50;
    var velocitySamples = sampleVelocityCurve(x1Clamped, y1, x2Clamped, y2, sampleCount);

    // Draw velocity curve
    var curvePath = new cavalry.Path();

    var rawStartVal = velocitySamples[0];
    var rawEndVal = velocitySamples[sampleCount];
    var targetStartVal = speedEasing.outSpeedY;
    var targetEndVal = speedEasing.inSpeedY;
    var deltaStart = targetStartVal - rawStartVal;
    var deltaEnd = targetEndVal - rawEndVal;

    var firstY = endY + (targetStartVal * graphHeight);
    curvePath.moveTo(startX, firstY);

    for (var i = 1; i <= sampleCount; i++) {
        var t = i / sampleCount;
        var sampleX = startX + t * (endX - startX);
        var shift = deltaStart + t * (deltaEnd - deltaStart);
        var transformedVal = velocitySamples[i] + shift;
        var sampleY = endY + (transformedVal * graphHeight);
        curvePath.lineTo(sampleX, sampleY);
    }

    var curvePaint = {"color": tokens.curve, "stroke": true, "strokeWidth": 2};
    canvas.addPath(curvePath.toObject(), curvePaint);

    // Draw horizontal lines from edges to handles, before the handles so the
    // handles and their shadows sit on top.
    var linePath = new cavalry.Path();
    linePath.moveTo(startX, outHandleY);
    linePath.lineTo(outHandleX, outHandleY);
    linePath.moveTo(endX, inHandleY);
    linePath.lineTo(inHandleX, inHandleY);

    var linePaint = {"color": tokens.accent, "stroke": true, "strokeWidth": 3};
    canvas.addPath(linePath.toObject(), linePaint);

    // Draw handles
    drawHandle(canvas, outHandleX, outHandleY, hoverRadius('out', config.hoveredHandle, handleRadius), tokens);
    drawHandle(canvas, inHandleX, inHandleY, hoverRadius('in', config.hoveredHandle, handleRadius), tokens);

    canvas.redraw();
}
