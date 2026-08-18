// Graph rendering module
// Functions for drawing the value curve and speed curve on canvas elements

import {
    cubicBezierToSpeed,
    sampleVelocityCurveWithMax,
    neighbourCurveControlPoints,
    speedGhostPolyline
} from './conversions.js';
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

// Grid tile geometry, traced from the design's 48px tile. The curve inset
// scales with the tile so larger tiles keep the same proportions.
var TILE_PADDING_RATIO = 7 / 48;

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
 * Draw a preset's curve at row-icon scale: no grid, handles or shadow.
 * Drawn live from the preset rather than shipped as an image, so it always
 * matches the stored easing and follows the theme.
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} easing - {x1, y1, x2, y2}
 * @param {number} size - Canvas edge length in px
 * @param {string} color - Curve colour, hex string
 */
export function drawCurveThumbnail(canvas, easing, size, color) {
    canvas.clearPaths();

    var padding = 3;
    var low = padding;
    var high = size - padding;
    var span = high - low;

    // ui.Draw is y-up, so `low` is the bottom edge and the curve runs from
    // bottom-left to top-right, matching the main graph.
    var path = new cavalry.Path();
    path.moveTo(low, low);
    path.cubicTo(
        low + easing.x1 * span, low + easing.y1 * span,
        low + easing.x2 * span, low + easing.y2 * span,
        high, high
    );

    canvas.addPath(path.toObject(), {
        "color": color,
        "stroke": true,
        "strokeWidth": 1.5
    });

    canvas.redraw();
}

/**
 * Draw a preset tile for the grid layout.
 * Tiles carry no menu affordance — right-click opens the menu — because a
 * drawn-in pill cannot be a real widget (Cavalry layouts have no z-stacking)
 * and hit-testing it was more fragile than it was worth.
 *
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} easing - {x1, y1, x2, y2}
 * @param {number} size - Tile edge length in px
 * @param {Object} tokens - Theme tokens
 */
export function drawPresetTile(canvas, easing, size, tokens) {
    canvas.clearPaths();

    var padding = size * TILE_PADDING_RATIO;
    var low = padding;
    var high = size - padding;
    var span = high - low;

    var path = new cavalry.Path();
    path.moveTo(low, low);
    path.cubicTo(
        low + easing.x1 * span, low + easing.y1 * span,
        low + easing.x2 * span, low + easing.y2 * span,
        high, high
    );
    canvas.addPath(path.toObject(), {
        "color": tokens.text,
        "stroke": true,
        "strokeWidth": 1.5
    });

    canvas.redraw();
}

var BANNER_MARGIN = 4;
var BANNER_TEXT_SIZE = 12;
var BANNER_BASELINE = 2;
var BANNER_ICON_SIZE = 13;
// The heart is drawn from a 13.3 x 11.7 trace, which overhangs 12px text whose
// caps are only ~8.5px tall. Scaled down and centred on the cap height rather
// than sitting on the baseline like the text does.
var BANNER_ICON_SCALE = 0.9;
var BANNER_CAP_HEIGHT = 8.5;
// Padding around the two hit targets, so they are comfortable to click without
// making the whole strip swallow clicks meant for the graph.
var BANNER_HIT_PADDING = 4;

/**
 * Mirror a path builder's Y axis. Traced SVG coordinates are y-down; ui.Draw
 * is y-up.
 */
function flipY(path, height, scale) {
    var s = scale || 1;

    return {
        moveTo: function(x, y) {
            path.moveTo(x * s, (height - y) * s);
        },
        lineTo: function(x, y) {
            path.lineTo(x * s, (height - y) * s);
        },
        cubicTo: function(x1, y1, x2, y2, x, y) {
            path.cubicTo(x1 * s, (height - y1) * s, x2 * s, (height - y2) * s, x * s, (height - y) * s);
        },
        close: function() {
            path.close();
        }
    };
}

/**
 * The banner's two hit targets, in the canvas's y-up coordinates.
 *
 * Only these areas are clickable — the rest of the strip stays available to the
 * graph beneath. The download width is measured from the real text path rather
 * than estimated, so the target always matches what is drawn.
 *
 * @param {number} width - Canvas width
 * @returns {Object} {dismiss, download} each {left, right, bottom, top}
 */
export function updateBannerRegions(width) {
    var measure = new cavalry.Path();
    measure.addText("Download", BANNER_TEXT_SIZE, 0, 0);
    var textWidth = measure.boundingBox().width;

    var bottom = 0;
    var top = BANNER_BASELINE + BANNER_TEXT_SIZE + BANNER_HIT_PADDING;

    return {
        // The whole strip, used only for hover — it reveals the dismiss X. It
        // is deliberately not a click target, so clicks elsewhere still reach
        // the graph.
        row: {
            left: 0,
            right: width,
            bottom: bottom,
            top: top
        },
        dismiss: {
            left: BANNER_MARGIN - BANNER_HIT_PADDING,
            right: BANNER_MARGIN + BANNER_ICON_SIZE + BANNER_HIT_PADDING,
            bottom: bottom,
            top: top
        },
        download: {
            left: width - BANNER_MARGIN - textWidth - BANNER_HIT_PADDING,
            right: width - BANNER_MARGIN + BANNER_HIT_PADDING,
            bottom: bottom,
            top: top
        },
        textWidth: textWidth
    };
}

/**
 * Whether a position falls inside one of the banner's named regions.
 * @param {Object} regions - From updateBannerRegions
 * @param {string} name - Region key, e.g. "row" or "download"
 * @param {Object} position - {x, y} in canvas coordinates
 * @returns {boolean}
 */
export function updateBannerContains(regions, name, position) {
    return contains(regions[name], position);
}

function contains(region, position) {
    return position.x >= region.left && position.x <= region.right &&
           position.y >= region.bottom && position.y <= region.top;
}

/**
 * Which part of the banner a click landed on, if any.
 *
 * Mouse positions share the canvas's y-up space — the same space the handle
 * hit-testing uses — so the banner along the bottom edge is at *low* y.
 *
 * @param {Object} position - {x, y} in canvas coordinates
 * @param {number} width - Canvas width
 * @returns {string|null} "dismiss", "download", or null
 */
export function updateBannerHit(position, width) {
    var regions = updateBannerRegions(width);

    if (contains(regions.dismiss, position)) return "dismiss";
    if (contains(regions.download, position)) return "download";

    return null;
}

/**
 * Draw the "New update!" banner along the bottom of a graph.
 *
 * Painted into the graph canvas rather than added as a widget so it overlays
 * the graph instead of taking layout space, as the design intends.
 *
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {number} width - Canvas width
 * @param {Object} tokens - Theme tokens
 * @param {boolean} rowHovered - Show the dismiss X in place of the heart
 * @param {boolean} downloadHovered - Emphasise the download link
 */
function drawUpdateBanner(canvas, width, tokens, rowHovered, downloadHovered) {
    var paint = { "color": tokens.textMuted, "stroke": false };
    var regions = updateBannerRegions(width);
    var baseline = BANNER_BASELINE;

    if (rowHovered) {
        // An X in place of the heart, so the banner can be dismissed when it
        // sits over part of the curve.
        var cross = new cavalry.Path();
        var crossSize = 9;
        var low = baseline + (BANNER_CAP_HEIGHT - crossSize) / 2;
        var high = low + crossSize;
        var left = BANNER_MARGIN + 1;
        var right = left + crossSize;

        cross.moveTo(left, low);
        cross.lineTo(right, high);
        cross.moveTo(left, high);
        cross.lineTo(right, low);

        canvas.addPath(cross.toObject(), {
            "color": tokens.text,
            "stroke": true,
            "strokeWidth": 1.5
        });
    } else {
        var heart = new cavalry.Path();
        var h = flipY(heart, 11.684, BANNER_ICON_SCALE);
        h.moveTo(9.974, 0);
        h.cubicTo(11.831, 0, 13.336, 1.771, 13.337, 3.956);
        h.cubicTo(13.337, 6.680, 9.643, 9.863, 7.754, 11.312);
        h.cubicTo(7.108, 11.808, 6.228, 11.808, 5.582, 11.312);
        h.cubicTo(3.693, 9.862, 0, 6.680, 0, 3.956);
        h.cubicTo(0, 1.771, 1.505, 0, 3.362, 0);
        h.cubicTo(5.011, 0, 6.381, 1.397, 6.668, 3.239);
        h.cubicTo(6.955, 1.397, 8.326, 0, 9.974, 0);
        h.close();
        // Centre the glyph on the text's cap height.
        var heartHeight = 11.684 * BANNER_ICON_SCALE;
        heart.translate(BANNER_MARGIN, baseline + (BANNER_CAP_HEIGHT - heartHeight) / 2);
        canvas.addPath(heart.toObject(), paint);
    }

    var label = new cavalry.Path();
    label.addText("New update!", BANNER_TEXT_SIZE, BANNER_MARGIN + 18, baseline);
    canvas.addPath(label.toObject(), paint);

    var downloadPath = new cavalry.Path();
    downloadPath.addText("Download", BANNER_TEXT_SIZE, 0, baseline);
    downloadPath.translate(width - BANNER_MARGIN - regions.textWidth, 0);

    // addText has no weight, so bold is faked by stroking the glyphs on top of
    // their own fill. Hover brightens it to the full text colour.
    var downloadColor = downloadHovered ? tokens.text : tokens.textMuted;
    var downloadShape = downloadPath.toObject();
    canvas.addPath(downloadShape, { "color": downloadColor, "stroke": false });
    canvas.addPath(downloadShape, {
        "color": downloadColor,
        "stroke": true,
        "strokeWidth": downloadHovered ? 1 : 0.7
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

// Ghost curves: how far the neighbouring segments' colour is faded toward the plot
// background. Traced from the design's #515151 on #373737 — dimmer than the curve, still
// clearly brighter than the grid. Fading rather than setting a literal grey keeps them
// legible when the Cavalry theme changes, the same trick textMuted uses.
var GHOST_FADE = 0.86;
var GHOST_STROKE = 2;
// Hovering is the only affordance available — ui.Draw exposes no cursor control — so the
// highlight has to carry it alone: brighten toward the accent and thicken a little.
var GHOST_HOVER_STROKE = 3;
var GHOST_HOVER_FADE = 0.25;
// Enough to keep the visible stub smooth; only the part inside the gutter is ever seen.
var GHOST_SAMPLES = 24;

function ghostPaint(tokens, hovered) {
    return {
        "color": hovered
            ? blend(tokens.accent, tokens.plotBg, GHOST_HOVER_FADE)
            : blend(tokens.curve, tokens.plotBg, GHOST_FADE),
        "stroke": true,
        "strokeWidth": hovered ? GHOST_HOVER_STROKE : GHOST_STROKE
    };
}

/**
 * Draw the previous and next segments as dim continuations in the gutter.
 *
 * Read-only decoration: no handles, no control lines, no hit targets. The neighbours cannot
 * land inside the plot rect (their frames lie outside it), so nothing is clipped here — the
 * canvas edge cuts off whatever runs past the padding, which is what the design shows.
 *
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} neighbours - {sel, prev, next} from readNeighbourSegments
 * @param {Object} bounds - {startX, startY, endX, endY} plot rectangle
 * @param {Object} tokens - Theme tokens
 */
function drawValueGhosts(canvas, neighbours, bounds, tokens, hoveredGhost) {
    var sides = [["prev", neighbours.prev], ["next", neighbours.next]];

    for (var i = 0; i < sides.length; i++) {
        var points = neighbourCurveControlPoints(sides[i][0], neighbours.sel, sides[i][1], bounds);
        if (!points) continue;

        // One path per side rather than one for both, so only the hovered curve lights up.
        var path = new cavalry.Path();
        path.moveTo(points.p0[0], points.p0[1]);
        path.cubicTo(
            points.cp1[0], points.cp1[1],
            points.cp2[0], points.cp2[1],
            points.p3[0], points.p3[1]
        );
        canvas.addPath(path.toObject(), ghostPaint(tokens, hoveredGhost === sides[i][0]));
    }
}

/**
 * Draw the neighbouring segments' velocity as dim continuations in the gutter.
 *
 * The speed graph normalises each segment against its own peak, so a neighbour has to be
 * measured against the SELECTED segment's peak in real value-per-frame units — otherwise
 * every neighbour would peak at full height and say nothing about relative speed. A
 * neighbour genuinely faster than the selection therefore runs off the top and is clipped,
 * which is the honest reading.
 *
 * ponytail: the main curve's endpoints are nudged to sit on the handles (deltaStart /
 * deltaEnd below); the ghosts get no such nudge, so a small gap can show at the join.
 * Closing it means dropping that fudge from the main curve — a bigger change than this.
 *
 * @param {Object} canvas - The ui.Draw canvas element
 * @param {Object} neighbours - {sel, prev, next} from readNeighbourSegments
 * @param {Object} bounds - {startX, startY, endX, endY} plot rectangle
 * @param {number} selPeak - the selected segment's peak speed, in value per frame
 * @param {Object} tokens - Theme tokens
 */
function drawSpeedGhosts(canvas, neighbours, bounds, selPeak, tokens, hoveredGhost) {
    var sides = [["prev", neighbours.prev], ["next", neighbours.next]];

    for (var i = 0; i < sides.length; i++) {
        var ghost = speedGhostPolyline(sides[i][0], neighbours.sel, sides[i][1], bounds, selPeak, GHOST_SAMPLES);
        if (!ghost) continue;

        // One path per side, so only the hovered curve lights up.
        var path = new cavalry.Path();
        for (var s = 0; s < ghost.points.length; s++) {
            if (s === 0) {
                path.moveTo(ghost.points[s][0], ghost.points[s][1]);
            } else {
                path.lineTo(ghost.points[s][0], ghost.points[s][1]);
            }
        }
        canvas.addPath(path.toObject(), ghostPaint(tokens, hoveredGhost === sides[i][0]));
    }
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

    var bounds = { startX: startX, startY: startY, endX: endX, endY: endY };
    drawGrid(canvas, bounds, tokens);

    // Before the curve, so the curve, handles and banner all paint over the ghosts.
    if (config.neighbours) {
        drawValueGhosts(canvas, config.neighbours, bounds, tokens, config.hoveredGhost);
    }

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

    if (config.updateAvailable) {
        drawUpdateBanner(canvas, width, tokens, config.bannerRowHover, config.bannerDownloadHover);
    }

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

    var bounds = { startX: startX, startY: startY, endX: endX, endY: endY };
    drawGrid(canvas, bounds, tokens);

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
    var sampledSelection = sampleVelocityCurveWithMax(x1Clamped, y1, x2Clamped, y2, sampleCount);
    var velocitySamples = sampledSelection.samples;

    // Ghosts before the curve, so the curve and handles paint over them. The neighbours are
    // scaled against the selection's peak in real value-per-frame, which is what makes the
    // three segments comparable on one axis.
    if (config.neighbours && config.neighbours.sel.frameDiff > 0) {
        var selPeak = sampledSelection.max *
            Math.abs(config.neighbours.sel.valueDiff / config.neighbours.sel.frameDiff);
        drawSpeedGhosts(canvas, config.neighbours, bounds, selPeak, tokens, config.hoveredGhost);
    }

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

    if (config.updateAvailable) {
        drawUpdateBanner(canvas, width, tokens, config.bannerRowHover, config.bannerDownloadHover);
    }

    canvas.redraw();
}
