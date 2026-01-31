// Graph rendering module
// Functions for drawing the value curve and speed curve on canvas elements

import { cubicBezierToSpeed, sampleVelocityCurve } from './conversions.js';

/**
 * Draw the value (bezier) curve on the canvas
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} currentEasing - Current easing values {x1, y1, x2, y2}
 * @param {Object} config - Graph configuration {width, height, padding}
 */
export function drawCurve(canvas, currentEasing, config) {
    // Clear all paths
    canvas.clearPaths();
    
    var width = config.width;
    var height = config.height;
    var padding = config.padding;
    
    // Set background color
    canvas.setBackgroundColor(ui.getThemeColor("AlternateBase"));
    
    // Create grid paths
    var gridPath = new cavalry.Path();
    
    // Vertical grid lines - extend to fill entire padded area
    for (var i = 0; i <= 10; i++) {
        var x = padding + (i * (width - 2 * padding) / 10);
        gridPath.moveTo(x, 0);
        gridPath.lineTo(x, height);
    }
    
    // Horizontal grid lines - extend to fill entire padded area
    for (var i = 0; i <= 10; i++) {
        var y = padding + (i * (height - 2 * padding) / 10);
        gridPath.moveTo(0, y);
        gridPath.lineTo(width, y);
    }
    
    // Add grid to canvas
    var gridPaint = {"color": "#3a3a3a", "stroke": true, "strokeWidth": 1};
    if (gridPath && gridPath.toObject) {
        canvas.addPath(gridPath.toObject(), gridPaint);
    }
    
    // Create bezier curve path
    var curvePath = new cavalry.Path();
    var startX = padding;
    var startY = height - padding;
    var endX = width - padding;
    var endY = padding;
    
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
    
    var curvePaint = {"color": "#ffffff", "stroke": true, "strokeWidth": 2};
    if (curvePath && curvePath.toObject) {
        canvas.addPath(curvePath.toObject(), curvePaint);
    }
    
    // Create control handles (use visible positions for drawing)
    var handle1Path = new cavalry.Path();
    handle1Path.addEllipse(visibleCp1X, visibleCp1Y, 6, 6);
    
    var handle2Path = new cavalry.Path();
    handle2Path.addEllipse(visibleCp2X, visibleCp2Y, 6, 6);
    
    var handlePaint = {"color": ui.getThemeColor("Accent1"), "stroke": false};
    if (handle1Path && handle1Path.toObject) {
        canvas.addPath(handle1Path.toObject(), handlePaint);
    }
    if (handle2Path && handle2Path.toObject) {
        canvas.addPath(handle2Path.toObject(), handlePaint);
    }
    
    // Create control lines (use visible positions for drawing)
    var controlPath = new cavalry.Path();
    controlPath.moveTo(startX, endY);
    controlPath.lineTo(visibleCp1X, visibleCp1Y);
    controlPath.moveTo(endX, startY);
    controlPath.lineTo(visibleCp2X, visibleCp2Y);
    
    var controlPaint = {"color": ui.getThemeColor("Accent1"), "stroke": true, "strokeWidth": 1};
    if (controlPath && controlPath.toObject) {
        canvas.addPath(controlPath.toObject(), controlPaint);
    }
    
    // Trigger redraw
    canvas.redraw();
}

/**
 * Draw the speed curve on the speed graph canvas (velocity-based)
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} currentEasing - Current easing values {x1, y1, x2, y2}
 * @param {Object} speedEasing - Speed easing state to update
 * @param {Object} config - Graph configuration {width, height, padding}
 */
export function drawSpeedCurve(canvas, currentEasing, speedEasing, config) {
    // Always sync speedEasing from currentEasing before drawing
    var speed = cubicBezierToSpeed(currentEasing.x1, currentEasing.y1, currentEasing.x2, currentEasing.y2);
    speedEasing.outInfluence = speed.outInfluence;
    speedEasing.inInfluence = speed.inInfluence;
    speedEasing.outSpeedY = speed.outSpeedY;
    speedEasing.inSpeedY = speed.inSpeedY;
    
    canvas.clearPaths();
    
    var width = config.width;
    var height = config.height;
    var padding = config.padding;
    
    canvas.setBackgroundColor(ui.getThemeColor("AlternateBase"));
    
    // Draw grid
    var gridPath = new cavalry.Path();
    for (var i = 0; i <= 10; i++) {
        var x = padding + (i * (width - 2 * padding) / 10);
        gridPath.moveTo(x, 0);
        gridPath.lineTo(x, height);
    }
    for (var i = 0; i <= 10; i++) {
        var y = padding + (i * (height - 2 * padding) / 10);
        gridPath.moveTo(0, y);
        gridPath.lineTo(width, y);
    }
    var gridPaint = {"color": "#3a3a3a", "stroke": true, "strokeWidth": 1};
    if (gridPath && gridPath.toObject) {
        canvas.addPath(gridPath.toObject(), gridPaint);
    }
    
    // Graph coordinates
    var startX = padding;
    var startY = height - padding;
    var endX = width - padding;
    var endY = padding;
    var midX = startX + (endX - startX) / 2;
    
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
    
    var curvePaint = {"color": "#ffffff", "stroke": true, "strokeWidth": 2};
    canvas.addPath(curvePath.toObject(), curvePaint);
    
    // Draw handles
    var handle1Path = new cavalry.Path();
    handle1Path.addEllipse(outHandleX, outHandleY, 6, 6);
    
    var handle2Path = new cavalry.Path();
    handle2Path.addEllipse(inHandleX, inHandleY, 6, 6);
    
    var handlePaint = {"color": ui.getThemeColor("Accent1"), "stroke": false};
    canvas.addPath(handle1Path.toObject(), handlePaint);
    canvas.addPath(handle2Path.toObject(), handlePaint);
    
    // Draw horizontal lines from edges to handles
    var linePath = new cavalry.Path();
    linePath.moveTo(startX, outHandleY);
    linePath.lineTo(outHandleX, outHandleY);
    linePath.moveTo(endX, inHandleY);
    linePath.lineTo(inHandleX, inHandleY);
    
    var linePaint = {"color": ui.getThemeColor("Accent1"), "stroke": true, "strokeWidth": 2};
    canvas.addPath(linePath.toObject(), linePaint);
    
    canvas.redraw();
}
