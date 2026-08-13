// Mouse event handler module
// Handles mouse interactions for both value and speed graph canvases

import { speedToCubicBezier } from './conversions.js';

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
        var handles = valueHandlePositions(config, state);
        var hit = handleAt(position, handles, ['cp1', 'cp2'], config.handleRadius * 2);

        if (!hit) return;

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
            var hovered = handleAt(position, valueHandlePositions(config, state), ['cp1', 'cp2'], config.handleRadius * 2);

            if (hovered !== state.hoveredHandle) {
                state.hoveredHandle = hovered;
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
        var handles = speedHandlePositions(config, state);
        var hit = handleAt(position, handles, ['out', 'in'], config.handleRadius * 2);

        if (!hit) return;

        state.speedDragging = true;
        state.speedDragHandle = hit;
    };

    canvas.onMouseMove = function(position, modifiers) {
        var config = getConfig();

        // Fires without a button held because the canvas enables hover events.
        if (!state.speedDragging) {
            var hovered = handleAt(position, speedHandlePositions(config, state), ['out', 'in'], config.handleRadius * 2);

            if (hovered !== state.speedHoveredHandle) {
                state.speedHoveredHandle = hovered;
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
