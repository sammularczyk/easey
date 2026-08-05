// Mouse event handler module
// Handles mouse interactions for both value and speed graph canvases

import { speedToCubicBezier } from './conversions.js';

/**
 * Create mouse handlers for the value graph canvas
 * @param {Object} options - Handler options
 * @param {Object} options.canvas - The graph canvas element
 * @param {Object} options.state - Shared state object
 * @param {Function} options.getConfig - Function that returns current graph configuration
 * @param {Function} options.onUpdate - Callback when values are updated
 * @param {Function} options.onDragEnd - Callback when drag ends
 */
export function setupValueGraphHandlers(options) {
    var canvas = options.canvas;
    var state = options.state;
    var getConfig = options.getConfig;
    var onUpdate = options.onUpdate;
    var onDragEnd = options.onDragEnd;
    
    canvas.onMousePress = function(position, button) {
        var config = getConfig();
        var startX = config.padding;
        var startY = config.height - config.padding;
        var endX = config.width - config.padding;
        var endY = config.padding;
        
        // Calculate actual handle positions
        var actualCp1X = startX + state.currentEasing.x1 * (endX - startX);
        var actualCp1Y = endY + state.currentEasing.y1 * (startY - endY);
        var actualCp2X = startX + state.currentEasing.x2 * (endX - startX);
        var actualCp2Y = endY + state.currentEasing.y2 * (startY - endY);
        
        // Clamp handle positions for click detection
        var cp1X = Math.max(startX - 20, Math.min(endX + 20, actualCp1X));
        var cp1Y = Math.max(endY - 20, Math.min(startY + 20, actualCp1Y));
        var cp2X = Math.max(startX - 20, Math.min(endX + 20, actualCp2X));
        var cp2Y = Math.max(endY - 20, Math.min(startY + 20, actualCp2Y));
        
        var dist1 = Math.sqrt((position.x - cp1X) * (position.x - cp1X) + (position.y - cp1Y) * (position.y - cp1Y));
        var dist2 = Math.sqrt((position.x - cp2X) * (position.x - cp2X) + (position.y - cp2Y) * (position.y - cp2Y));
        
        if (dist1 < config.handleRadius * 2) {
            state.isDragging = true;
            state.dragHandle = 'cp1';
            state.dragStartPosition = { x: position.x, y: position.y };
            state.dragStartEasing = {
                x1: state.currentEasing.x1,
                y1: state.currentEasing.y1,
                x2: state.currentEasing.x2,
                y2: state.currentEasing.y2
            };
            state.axisConstraint = null;
        } else if (dist2 < config.handleRadius * 2) {
            state.isDragging = true;
            state.dragHandle = 'cp2';
            state.dragStartPosition = { x: position.x, y: position.y };
            state.dragStartEasing = {
                x1: state.currentEasing.x1,
                y1: state.currentEasing.y1,
                x2: state.currentEasing.x2,
                y2: state.currentEasing.y2
            };
            state.axisConstraint = null;
        }
    };
    
    canvas.onMouseMove = function(position, modifiers) {
        if (!state.isDragging) return;
        
        var config = getConfig();
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
 */
export function setupSpeedGraphHandlers(options) {
    var canvas = options.canvas;
    var state = options.state;
    var getConfig = options.getConfig;
    var onUpdate = options.onUpdate;
    var onDragEnd = options.onDragEnd;
    
    canvas.onMousePress = function(position, button) {
        var config = getConfig();
        var startX = config.padding;
        var startY = config.height - config.padding;
        var endX = config.width - config.padding;
        var endY = config.padding;
        var midX = startX + (endX - startX) / 2;
        var graphHeight = startY - endY;
        
        var outHandleX = startX + (state.speedEasing.outInfluence / 100) * (midX - startX);
        var inHandleX = endX - (state.speedEasing.inInfluence / 100) * (endX - midX);
        var outHandleY = endY + (state.speedEasing.outSpeedY * graphHeight);
        var inHandleY = endY + (state.speedEasing.inSpeedY * graphHeight);
        
        var dist1 = Math.sqrt(Math.pow(position.x - outHandleX, 2) + Math.pow(position.y - outHandleY, 2));
        var dist2 = Math.sqrt(Math.pow(position.x - inHandleX, 2) + Math.pow(position.y - inHandleY, 2));
        
        if (dist1 < config.handleRadius * 2) {
            state.speedDragging = true;
            state.speedDragHandle = 'out';
        } else if (dist2 < config.handleRadius * 2) {
            state.speedDragging = true;
            state.speedDragHandle = 'in';
        }
    };
    
    canvas.onMouseMove = function(position, modifiers) {
        if (!state.speedDragging) return;
        
        var config = getConfig();
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
