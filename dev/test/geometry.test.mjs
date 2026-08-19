// Run with: node dev/test/geometry.test.mjs
// Geometry shared by the graph renderer and its mouse handlers: the plot rectangle and the
// handle-overflow clamp that keeps drawing and hit-testing in agreement.

import assert from "node:assert/strict";
import { plotBounds, clampHandleToPlot, flipY, HANDLE_OVERFLOW } from "../src/modules/geometry.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// --- plotBounds --------------------------------------------------------------

const config = { width: 300, height: 200, padding: 10 };
const bounds = plotBounds(config);

assert.equal(bounds.startX, 10, "startX is the left padding");
assert.equal(bounds.startY, 190, "startY is height minus padding (bottom edge)");
assert.equal(bounds.endX, 290, "endX is width minus padding");
assert.equal(bounds.endY, 10, "endY is the top padding");
assert.equal(bounds.midX, 150, "midX sits halfway between startX and endX");
assert.equal(bounds.graphHeight, 180, "graphHeight is startY minus endY");

// A non-square graph, to make sure width and height aren't conflated.
const wide = plotBounds({ width: 500, height: 120, padding: 20 });
assert.equal(wide.startX, 20, "wide: startX only depends on padding");
assert.equal(wide.startY, 100, "wide: startY depends on height");
assert.equal(wide.endX, 480, "wide: endX depends on width");
assert.equal(wide.midX, 250, "wide: midX still halfway across");
assert.equal(wide.graphHeight, 80, "wide: graphHeight depends on height, not width");

// --- clampHandleToPlot --------------------------------------------------------

// Inside the plot: passes through unchanged.
const inside = clampHandleToPlot(150, 100, bounds);
assert.equal(inside.x, 150, "a point inside the plot keeps its x");
assert.equal(inside.y, 100, "a point inside the plot keeps its y");

// Exactly at the overflow boundary: still unclamped.
const atBoundaryX = clampHandleToPlot(bounds.startX - HANDLE_OVERFLOW, bounds.startY, bounds);
assert.equal(atBoundaryX.x, bounds.startX - HANDLE_OVERFLOW, "x right at the overflow limit is not clamped further");

const atBoundaryY = clampHandleToPlot(bounds.startX, bounds.startY + HANDLE_OVERFLOW, bounds);
assert.equal(atBoundaryY.y, bounds.startY + HANDLE_OVERFLOW, "y right at the overflow limit is not clamped further");

// One px past the boundary: clamped back to the limit.
const pastLeft = clampHandleToPlot(bounds.startX - HANDLE_OVERFLOW - 1, 100, bounds);
assert.equal(pastLeft.x, bounds.startX - HANDLE_OVERFLOW, "past the left overflow limit clamps to it");

const pastRight = clampHandleToPlot(bounds.endX + HANDLE_OVERFLOW + 1, 100, bounds);
assert.equal(pastRight.x, bounds.endX + HANDLE_OVERFLOW, "past the right overflow limit clamps to it");

const pastTop = clampHandleToPlot(150, bounds.endY - HANDLE_OVERFLOW - 1, bounds);
assert.equal(pastTop.y, bounds.endY - HANDLE_OVERFLOW, "past the top overflow limit clamps to it");

const pastBottom = clampHandleToPlot(150, bounds.startY + HANDLE_OVERFLOW + 1, bounds);
assert.equal(pastBottom.y, bounds.startY + HANDLE_OVERFLOW, "past the bottom overflow limit clamps to it");

// Extreme values clamp on both axes at once.
const farAway = clampHandleToPlot(-99999, 99999, bounds);
assert.equal(farAway.x, bounds.startX - HANDLE_OVERFLOW, "a wildly off-plot x still clamps to the overflow limit");
assert.equal(farAway.y, bounds.startY + HANDLE_OVERFLOW, "a wildly off-plot y still clamps to the overflow limit");

// --- flipY --------------------------------------------------------------------

// A fake path recorder standing in for cavalry.Path, so this runs under node.
function fakePath() {
    var calls = [];
    return {
        calls: calls,
        moveTo: (x, y) => calls.push(["moveTo", x, y]),
        lineTo: (x, y) => calls.push(["lineTo", x, y]),
        cubicTo: (x1, y1, x2, y2, x, y) => calls.push(["cubicTo", x1, y1, x2, y2, x, y]),
        close: () => calls.push(["close"])
    };
}

// No scale (defaults to 1): only the y coordinates flip.
const unscaled = fakePath();
const u = flipY(unscaled, 10);
u.moveTo(2, 3);
u.lineTo(4, 8);
u.cubicTo(1, 1, 2, 2, 3, 3);
u.close();
assert.deepEqual(unscaled.calls, [
    ["moveTo", 2, 7],
    ["lineTo", 4, 2],
    ["cubicTo", 1, 9, 2, 8, 3, 7],
    ["close"]
], "flipY with no scale only mirrors y against the given height");

// With scale: every coordinate (including x) is scaled after the flip.
const scaled = fakePath();
const s = flipY(scaled, 10, 2);
s.moveTo(2, 3);
s.lineTo(4, 8);
assert.deepEqual(scaled.calls, [
    ["moveTo", 4, 14],
    ["lineTo", 8, 4]
], "flipY with a scale multiplies both axes after flipping y");

console.log("geometry: ok");
