// Mouse event handler module
// Handles mouse interactions for both value and speed graph canvases

import {
    speedToCubicBezier,
    cubicBezierToSpeed,
    neighbourCurveControlPoints,
    tangentMatchedHandle,
    speedGhostPolyline,
    sampleVelocityCurveWithMax
} from './conversions.js';
import { updateBannerHit, updateBannerRegions, updateBannerContains } from './graphRenderer.js';

/**
 * On-screen positions of the value graph's two control handles, clamped the
 * same way graphRenderer clamps them so hit-testing matches what is drawn.
 * @param {Object} config - Graph configuration
 * @param {Object} state - Shared state object
 * @returns {Object} {cp1: {x, y}, cp2: {x, y}}
 */
function valueHandlePositions(config, state) {
    var startX = config.padding;
    var startY = config.height - config.padding;
    var endX = config.width - config.padding;
    var endY = config.padding;

    var cp1X = startX + state.currentEasing.x1 * (endX - startX);
    var cp1Y = endY + state.currentEasing.y1 * (startY - endY);
    var cp2X = startX + state.currentEasing.x2 * (endX - startX);
    var cp2Y = endY + state.currentEasing.y2 * (startY - endY);

    return {
        cp1: {
            x: Math.max(startX - 20, Math.min(endX + 20, cp1X)),
            y: Math.max(endY - 20, Math.min(startY + 20, cp1Y))
        },
        cp2: {
            x: Math.max(startX - 20, Math.min(endX + 20, cp2X)),
            y: Math.max(endY - 20, Math.min(startY + 20, cp2Y))
        }
    };
}

/**
 * On-screen positions of the speed graph's influence handles.
 * @param {Object} config - Graph configuration
 * @param {Object} state - Shared state object
 * @returns {Object} {out: {x, y}, in: {x, y}}
 */
function speedHandlePositions(config, state) {
    var startX = config.padding;
    var startY = config.height - config.padding;
    var endX = config.width - config.padding;
    var endY = config.padding;
    var midX = startX + (endX - startX) / 2;
    var graphHeight = startY - endY;

    return {
        out: {
            x: startX + (state.speedEasing.outInfluence / 100) * (midX - startX),
            y: endY + (state.speedEasing.outSpeedY * graphHeight)
        },
        in: {
            x: endX - (state.speedEasing.inInfluence / 100) * (endX - midX),
            y: endY + (state.speedEasing.inSpeedY * graphHeight)
        }
    };
}

/**
 * First handle within grabbing distance, tested in the given order.
 * @param {Object} position - {x, y} mouse position
 * @param {Object} handles - Map of handle key to {x, y}
 * @param {Array} order - Handle keys, highest priority first
 * @param {number} radius - Grab radius
 * @returns {string|null} Handle key, or null when none is close enough
 */
function handleAt(position, handles, order, radius) {
    for (var i = 0; i < order.length; i++) {
        var handle = handles[order[i]];
        var dx = position.x - handle.x;
        var dy = position.y - handle.y;

        if (Math.sqrt(dx * dx + dy * dy) < radius) {
            return order[i];
        }
    }

    return null;
}

/**
 * Route a press that landed on the update banner.
 * @returns {boolean} Whether the press was consumed
 */
function handleBannerPress(position, config, options) {
    var hit = updateBannerHit(position, config.width);

    if (hit === "download") {
        if (options.onUpdateBannerClick) options.onUpdateBannerClick();
        return true;
    }

    if (hit === "dismiss") {
        if (options.onUpdateBannerDismiss) options.onUpdateBannerDismiss();
        return true;
    }

    return false;
}

/**
 * Track hover over the banner: anywhere on the strip reveals the dismiss X,
 * and the download link highlights on its own.
 * @returns {boolean} Whether either hover state changed
 */
function updateBannerHover(position, config, state) {
    var row = false;
    var download = false;

    if (config.updateAvailable) {
        var regions = updateBannerRegions(config.width);
        row = updateBannerContains(regions, "row", position);
        download = row && updateBannerContains(regions, "download", position);
    }

    if (row === state.bannerRowHover && download === state.bannerDownloadHover) {
        return false;
    }

    state.bannerRowHover = row;
    state.bannerDownloadHover = download;
    return true;
}


// How near the pointer must come to a ghost curve to grab it. Matches the handles' own grab
// radius (handleRadius * 2), because the ghosts are thin, often short, and have nothing else
// out in the gutter to be confused with.
var GHOST_GRAB_RADIUS = 12;
// Distance is measured to the line BETWEEN samples, not to the samples themselves, so this
// only has to be dense enough to follow the curvature — not dense enough to cover the grab
// radius. Point sampling alone would leave dead gaps along any ghost wider than a few hundred
// pixels.
var GHOST_HIT_SAMPLES = 24;

function plotBounds(config) {
    return {
        startX: config.padding,
        startY: config.height - config.padding,
        endX: config.width - config.padding,
        endY: config.padding
    };
}

function cubicPoint(p0, cp1, cp2, p3, t) {
    var m = 1 - t;
    var a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
    return [
        a * p0[0] + b * cp1[0] + c * cp2[0] + d * p3[0],
        a * p0[1] + b * cp1[1] + c * cp2[1] + d * p3[1]
    ];
}

/** Shortest distance from a point to the line segment ab. */
function distanceToSegment(point, a, b) {
    var vx = b[0] - a[0];
    var vy = b[1] - a[1];
    var wx = point.x - a[0];
    var wy = point.y - a[1];
    var lengthSq = vx * vx + vy * vy;
    var t = lengthSq > 0 ? (wx * vx + wy * vy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    var dx = point.x - (a[0] + t * vx);
    var dy = point.y - (a[1] + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
}

/** True when the pointer is within the grab radius of a polyline. */
function nearPolyline(position, points) {
    for (var i = 1; i < points.length; i++) {
        if (distanceToSegment(position, points[i - 1], points[i]) < GHOST_GRAB_RADIUS) {
            return true;
        }
    }
    return false;
}

/**
 * The value-graph ghost under the pointer, if any.
 * Flattened to a polyline first: the curves are short and already approximate, so a
 * closed-form point-to-cubic distance would be far more machinery than a hover test earns.
 * @returns {{side: string, points: Object}|null}
 */
function ghostAt(position, config) {
    if (!config.neighbours) return null;

    var bounds = plotBounds(config);
    var sides = [['prev', config.neighbours.prev], ['next', config.neighbours.next]];

    for (var i = 0; i < sides.length; i++) {
        var points = neighbourCurveControlPoints(sides[i][0], config.neighbours.sel, sides[i][1], bounds);
        if (!points) continue;

        var flat = [];
        for (var s = 0; s <= GHOST_HIT_SAMPLES; s++) {
            flat.push(cubicPoint(points.p0, points.cp1, points.cp2, points.p3, s / GHOST_HIT_SAMPLES));
        }
        if (nearPolyline(position, flat)) {
            return { side: sides[i][0], points: points };
        }
    }
    return null;
}

/**
 * The selected segment's peak speed in value per frame — the scale every speed ghost is
 * measured against. Mirrors what drawSpeedCurve computes so hit-testing matches the drawing.
 */
function selectedSpeedPeak(config, state) {
    var sel = config.neighbours && config.neighbours.sel;
    if (!sel || !(sel.frameDiff > 0)) return 0;

    var easing = state.currentEasing;
    var sampled = sampleVelocityCurveWithMax(
        Math.min(0.999, Math.max(0.001, easing.x1)),
        easing.y1,
        Math.min(0.999, Math.max(0.001, easing.x2)),
        easing.y2,
        50
    );
    return sampled.max * Math.abs(sel.valueDiff / sel.frameDiff);
}

/**
 * The speed-graph ghost under the pointer, if any.
 * @returns {{side: string, joinHeight: number}|null}
 */
function speedGhostAt(position, config, state) {
    if (!config.neighbours) return null;

    var bounds = plotBounds(config);
    var selPeak = selectedSpeedPeak(config, state);
    var sides = [['prev', config.neighbours.prev], ['next', config.neighbours.next]];

    for (var i = 0; i < sides.length; i++) {
        var ghost = speedGhostPolyline(sides[i][0], config.neighbours.sel, sides[i][1], bounds, selPeak, GHOST_HIT_SAMPLES);
        if (!ghost) continue;
        if (nearPolyline(position, ghost.points)) {
            return { side: sides[i][0], joinHeight: ghost.joinHeight };
        }
    }
    return null;
}

/**
 * Create mouse handlers for the value graph canvas
 * @param {Object} options - Handler options
 * @param {Object} options.canvas - The graph canvas element
 * @param {Object} options.state - Shared state object
 * @param {Function} options.getConfig - Function that returns current graph configuration
 * @param {Function} options.onUpdate - Callback when values are updated
 * @param {Function} options.onDragEnd - Callback when drag ends
 * @param {Function} options.onHoverChange - Callback when the hovered handle changes
 */
export function setupValueGraphHandlers(options) {
    var canvas = options.canvas;
    var state = options.state;
    var getConfig = options.getConfig;
    var onUpdate = options.onUpdate;
    var onDragEnd = options.onDragEnd;
    var onHoverChange = options.onHoverChange;

    canvas.onMousePress = function(position, button) {
        var config = getConfig();

        // The prev ghost lands in the bottom-left gutter and runs down through the banner's
        // dismiss box, so the banner cannot simply claim that corner. A ghost actually under
        // the pointer wins; the X stays clickable everywhere the thin ghost line is not.
        var ghostUnderPointer = ghostAt(position, config);

        // Otherwise checked before the handles: the banner overlays the graph's bottom edge,
        // where a handle could sit.
        if (!ghostUnderPointer && config.updateAvailable && handleBannerPress(position, config, options)) return;

        var handles = valueHandlePositions(config, state);
        var hit = handleAt(position, handles, ['cp1', 'cp2'], config.handleRadius * 2);

        if (!hit) {
            var ghost = ghostUnderPointer;
            if (ghost) {
                var matched = tangentMatchedHandle(
                    ghost.side, ghost.points, plotBounds(config), state.currentEasing
                );
                if (matched) {
                    for (var key in matched) {
                        state.currentEasing[key] = matched[key];
                    }
                    if (onUpdate) onUpdate();
                    // Same completion path as releasing a handle drag, so a click applies and
                    // clears the preset selection exactly as dragging would.
                    if (onDragEnd) onDragEnd();
                }
            }
            return;
        }

        state.isDragging = true;
        state.dragHandle = hit;
        state.dragStartPosition = { x: position.x, y: position.y };
        state.dragStartEasing = {
            x1: state.currentEasing.x1,
            y1: state.currentEasing.y1,
            x2: state.currentEasing.x2,
            y2: state.currentEasing.y2
        };
        state.axisConstraint = null;
    };

    canvas.onMouseMove = function(position, modifiers) {
        var config = getConfig();

        // Fires without a button held because the canvas enables hover events.
        if (!state.isDragging) {
            var bannerChanged = updateBannerHover(position, config, state);
            var hovered = handleAt(position, valueHandlePositions(config, state), ['cp1', 'cp2'], config.handleRadius * 2);
            // Handles win: they overlap the gutter by up to 20px where they are clamped.
            var ghostHover = hovered ? null : (ghostAt(position, config) || {}).side || null;
            // A ghost under the pointer suppresses the banner's own hover, so the dismiss X
            // does not flicker in as you trace the curve past it.
            if (ghostHover) bannerChanged = false;

            if (hovered !== state.hoveredHandle || ghostHover !== state.hoveredGhost || bannerChanged) {
                state.hoveredHandle = hovered;
                state.hoveredGhost = ghostHover;
                if (onHoverChange) onHoverChange();
            }
            return;
        }

        var startX = config.padding;
        var startY = config.height - config.padding;
        var endX = config.width - config.padding;
        var endY = config.padding;
        
        var x = position.x;
        var y = position.y;
        
        var shiftPressed = api.isShiftHeld();
        
        if (shiftPressed) {
            if (state.dragStartPosition) {
                var currentX, currentY, originX, originY;
                
                if (state.dragHandle === 'cp1') {
                    currentX = state.currentEasing.x1;
                    currentY = state.currentEasing.y1;
                    originX = 0.0;
                    originY = 0.0;
                } else if (state.dragHandle === 'cp2') {
                    currentX = state.currentEasing.x2;
                    currentY = state.currentEasing.y2;
                    originX = 1.0;
                    originY = 1.0;
                }
                
                var deltaX = currentX - originX;
                var deltaY = currentY - originY;
                var angle = Math.atan2(Math.abs(deltaY), Math.abs(deltaX));
                
                if (angle < Math.PI / 4) {
                    state.axisConstraint = 'x';
                    var snapToY = (Math.abs(currentY - 0.0) < Math.abs(currentY - 1.0)) ? 0.0 : 1.0;
                    if (state.dragHandle === 'cp1') {
                        state.currentEasing.y1 = snapToY;
                    } else if (state.dragHandle === 'cp2') {
                        state.currentEasing.y2 = snapToY;
                    }
                } else {
                    state.axisConstraint = 'y';
                    var snapToX = (Math.abs(currentX - 0.0) < Math.abs(currentX - 1.0)) ? 0.0 : 1.0;
                    if (state.dragHandle === 'cp1') {
                        state.currentEasing.x1 = snapToX;
                    } else if (state.dragHandle === 'cp2') {
                        state.currentEasing.x2 = snapToX;
                    }
                }
            }
            
            if (state.axisConstraint === 'x') {
                y = state.dragStartPosition.y;
            } else if (state.axisConstraint === 'y') {
                x = state.dragStartPosition.x;
            }
        } else {
            state.axisConstraint = null;
        }
        
        if (state.dragHandle === 'cp1') {
            if (!shiftPressed || state.axisConstraint !== 'y') {
                state.currentEasing.x1 = (x - startX) / (endX - startX);
            }
            if (!shiftPressed || state.axisConstraint !== 'x') {
                state.currentEasing.y1 = (y - endY) / (startY - endY);
            }
        } else if (state.dragHandle === 'cp2') {
            if (!shiftPressed || state.axisConstraint !== 'y') {
                state.currentEasing.x2 = (x - startX) / (endX - startX);
            }
            if (!shiftPressed || state.axisConstraint !== 'x') {
                state.currentEasing.y2 = (y - endY) / (startY - endY);
            }
        }
        
        if (onUpdate) onUpdate();
    };
    
    canvas.onMouseRelease = function(position, button) {
        if (state.isDragging) {
            state.isDragging = false;
            state.dragHandle = null;
            state.dragStartPosition = null;
            state.dragStartEasing = null;
            state.axisConstraint = null;
            
            if (onDragEnd) onDragEnd();
        }
    };
}

/**
 * Create mouse handlers for the speed graph canvas
 * @param {Object} options - Handler options
 * @param {Object} options.canvas - The speed graph canvas element
 * @param {Object} options.state - Shared state object
 * @param {Function} options.getConfig - Function that returns current graph configuration
 * @param {Function} options.onUpdate - Callback when values are updated
 * @param {Function} options.onDragEnd - Callback when drag ends
 * @param {Function} options.onHoverChange - Callback when the hovered handle changes
 */
export function setupSpeedGraphHandlers(options) {
    var canvas = options.canvas;
    var state = options.state;
    var getConfig = options.getConfig;
    var onUpdate = options.onUpdate;
    var onDragEnd = options.onDragEnd;
    var onHoverChange = options.onHoverChange;

    canvas.onMousePress = function(position, button) {
        var config = getConfig();

        // As on the value graph: a ghost under the pointer outranks the banner, which would
        // otherwise swallow the bottom-left corner where the prev ghost arrives.
        var speedGhostUnderPointer = speedGhostAt(position, config, state);

        if (!speedGhostUnderPointer && config.updateAvailable && handleBannerPress(position, config, options)) return;

        var handles = speedHandlePositions(config, state);
        var hit = handleAt(position, handles, ['out', 'in'], config.handleRadius * 2);

        if (!hit) {
            // On this graph the y axis is speed, so meeting a neighbour means matching its
            // HEIGHT at the shared keyframe rather than an angle — the speed graph's own way
            // of saying the same thing the value graph says by rotating a handle.
            var ghost = speedGhostUnderPointer;
            if (ghost) {
                if (ghost.side === 'prev') {
                    state.speedEasing.outSpeedY = ghost.joinHeight;
                } else {
                    state.speedEasing.inSpeedY = ghost.joinHeight;
                }
                var updated = speedToCubicBezier(
                    state.speedEasing.outInfluence,
                    state.speedEasing.inInfluence,
                    state.speedEasing.outSpeedY,
                    state.speedEasing.inSpeedY
                );
                state.currentEasing.x1 = updated.x1;
                state.currentEasing.y1 = updated.y1;
                state.currentEasing.x2 = updated.x2;
                state.currentEasing.y2 = updated.y2;
                if (onUpdate) onUpdate();
                if (onDragEnd) onDragEnd();
            }
            return;
        }

        state.speedDragging = true;
        state.speedDragHandle = hit;
    };

    canvas.onMouseMove = function(position, modifiers) {
        var config = getConfig();

        // Fires without a button held because the canvas enables hover events.
        if (!state.speedDragging) {
            var bannerChanged = updateBannerHover(position, config, state);
            var hovered = handleAt(position, speedHandlePositions(config, state), ['out', 'in'], config.handleRadius * 2);
            // Handles win: they can sit over the gutter where the ghosts run.
            var ghostHover = hovered ? null : (speedGhostAt(position, config, state) || {}).side || null;

            if (hovered !== state.speedHoveredHandle || ghostHover !== state.hoveredGhost || bannerChanged) {
                state.speedHoveredHandle = hovered;
                state.hoveredGhost = ghostHover;
                if (onHoverChange) onHoverChange();
            }
            return;
        }

        var startX = config.padding;
        var startY = config.height - config.padding;
        var endX = config.width - config.padding;
        var endY = config.padding;
        var midX = startX + (endX - startX) / 2;
        var graphHeight = startY - endY;
        
        var shiftPressed = api.isShiftHeld();
        var cmdPressed = api.isControlHeld();
        
        if (state.speedDragHandle === 'out') {
            var clampedX = Math.max(startX, Math.min(midX, position.x));
            state.speedEasing.outInfluence = ((clampedX - startX) / (midX - startX)) * 100;
            
            if (!shiftPressed) {
                var clampedY = Math.max(endY, Math.min(startY, position.y));
                state.speedEasing.outSpeedY = (clampedY - endY) / graphHeight;
            }
            
            if (cmdPressed) {
                state.speedEasing.inInfluence = state.speedEasing.outInfluence;
                state.speedEasing.inSpeedY = state.speedEasing.outSpeedY;
            }
        } else if (state.speedDragHandle === 'in') {
            var clampedX = Math.max(midX, Math.min(endX, position.x));
            state.speedEasing.inInfluence = ((endX - clampedX) / (endX - midX)) * 100;
            
            if (!shiftPressed) {
                var clampedY = Math.max(endY, Math.min(startY, position.y));
                state.speedEasing.inSpeedY = (clampedY - endY) / graphHeight;
            }
            
            if (cmdPressed) {
                state.speedEasing.outInfluence = state.speedEasing.inInfluence;
                state.speedEasing.outSpeedY = state.speedEasing.inSpeedY;
            }
        }
        
        // Sync speed to value
        var cubic = speedToCubicBezier(state.speedEasing.outInfluence, state.speedEasing.inInfluence, state.speedEasing.outSpeedY, state.speedEasing.inSpeedY);
        state.currentEasing.x1 = cubic.x1;
        state.currentEasing.y1 = cubic.y1;
        state.currentEasing.x2 = cubic.x2;
        state.currentEasing.y2 = cubic.y2;
        
        if (onUpdate) onUpdate();
    };
    
    canvas.onMouseRelease = function(position, button) {
        if (state.speedDragging) {
            state.speedDragging = false;
            state.speedDragHandle = null;
            
            if (onDragEnd) onDragEnd();
        }
    };
}
