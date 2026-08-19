// Geometry helpers shared by the graph renderer and its mouse handlers.
// Pure maths, no Cavalry/ui/api calls, so it runs under node in test/geometry.test.mjs.

/**
 * How far a value/speed handle may run past the plot rectangle before being
 * clamped. Keeps handles grabbable and visible even when their easing value
 * pushes them off the edge.
 */
export var HANDLE_OVERFLOW = 20;

/**
 * The plot rectangle's four edges in canvas pixels, from a graph config.
 * Also includes the midpoint and height shortcuts the speed graph needs,
 * since every site that computes them derives the same values from the
 * same edges.
 * @param {Object} config - {width, height, padding}
 * @returns {{startX:number, startY:number, endX:number, endY:number, midX:number, graphHeight:number}}
 */
export function plotBounds(config) {
    var startX = config.padding;
    var startY = config.height - config.padding;
    var endX = config.width - config.padding;
    var endY = config.padding;

    return {
        startX: startX,
        startY: startY,
        endX: endX,
        endY: endY,
        midX: startX + (endX - startX) / 2,
        graphHeight: startY - endY
    };
}

/**
 * Clamp a handle position so it never strays more than HANDLE_OVERFLOW past
 * the plot rectangle. Used both to decide where a handle is drawn and where
 * it is hit-tested, so the two always agree.
 * @param {number} x
 * @param {number} y
 * @param {Object} bounds - {startX, startY, endX, endY} from plotBounds
 * @returns {{x:number, y:number}}
 */
export function clampHandleToPlot(x, y, bounds) {
    return {
        x: Math.max(bounds.startX - HANDLE_OVERFLOW, Math.min(bounds.endX + HANDLE_OVERFLOW, x)),
        y: Math.max(bounds.endY - HANDLE_OVERFLOW, Math.min(bounds.startY + HANDLE_OVERFLOW, y))
    };
}

/**
 * Path wrapper that flips the Y axis. ui.Draw is y-up (like Cavalry's scene)
 * but traced SVG coordinates are y-down, so tracing a Figma vector verbatim
 * renders it mirrored. Flipping here lets the builders keep the exported SVG
 * numbers as-is. An optional scale multiplies every coordinate after the
 * flip, for callers that trace a vector at one size and draw it at another.
 * @param {Object} path - A cavalry.Path
 * @param {number} height - Height of the traced viewBox
 * @param {number} [scale] - Uniform scale applied after flipping, default 1
 */
export function flipY(path, height, scale) {
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
