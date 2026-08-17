// Run with: node dev/test/neighbours.test.mjs
// Covers the geometry behind the neighbour-easing ghosts. The whole feature rests on one
// claim: extending the selected segment's linear map past the plot edges puts the previous
// and next segments in the gutter and NEVER over the grid. If that claim breaks, the ghosts
// start drawing across the curve being edited, so it is worth an assertion.

import assert from "node:assert/strict";
import {
    neighbourCurveControlPoints,
    sampleVelocityCurve,
    sampleVelocityCurveWithMax
} from "../src/modules/conversions.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// The plot rect drawCurve builds from GRAPH_CONFIG {width:230, height:230, padding:30}.
// ui.Draw is y-up, so endY is the bottom edge and startY the top.
const bounds = { startX: 30, startY: 200, endX: 200, endY: 30 };
const width = bounds.endX - bounds.startX;   // 170
const height = bounds.startY - bounds.endY;  // 170

const linear = { x1: 0, y1: 0, x2: 1, y2: 1 };
const sel = { frameDiff: 20, valueDiff: 100 };

// A neighbour identical to the selection is the readable case: it should occupy exactly one
// plot-width and one plot-height of gutter, mirrored through the shared corner.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: linear };

    const prev = neighbourCurveControlPoints("prev", sel, seg, bounds);
    near(prev.p3[0], bounds.startX, "prev meets the plot's left edge");
    near(prev.p3[1], bounds.endY, "prev meets the plot's bottom edge");
    near(prev.p0[0], bounds.startX - width, "prev starts one width left");
    near(prev.p0[1], bounds.endY - height, "prev starts one height below");

    const next = neighbourCurveControlPoints("next", sel, seg, bounds);
    near(next.p0[0], bounds.endX, "next leaves from the plot's right edge");
    near(next.p0[1], bounds.startY, "next leaves from the plot's top edge");
    near(next.p3[0], bounds.endX + width, "next ends one width right");
    near(next.p3[1], bounds.startY + height, "next ends one height above");
}

// The easing controls must land in the same proportions the main curve uses, so a ghost of
// the same easing is a true continuation rather than a differently-shaped line.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 } };
    const next = neighbourCurveControlPoints("next", sel, seg, bounds);
    near(next.cp1[0], bounds.endX + 0.25 * width, "cp1 x is a quarter along");
    near(next.cp1[1], bounds.startY + 0.1 * height, "cp1 y is a tenth up");
    near(next.cp2[0], bounds.endX + 0.75 * width, "cp2 x is three quarters along");
    near(next.cp2[1], bounds.startY + 0.9 * height, "cp2 y is nine tenths up");
}

// The no-overlap guarantee. A neighbour whose value runs the OTHER way (the layer reverses
// direction at the shared keyframe) sends the ghost vertically back across the plot's y
// range — but its x must still stay entirely outside the plot, so it cannot touch the grid.
{
    const reversed = { frameDiff: 20, valueDiff: -100, easing: linear };

    for (const side of ["prev", "next"]) {
        const pts = neighbourCurveControlPoints(side, sel, reversed, bounds);
        for (const [name, p] of Object.entries(pts)) {
            const outside = side === "prev" ? p[0] <= bounds.startX : p[0] >= bounds.endX;
            assert.ok(outside, `reversed ${side} ${name} stays out of the plot: x=${p[0]}`);
        }
    }
}

// A neighbour shorter in frames than the selection must compress in x, not get its own 0..1
// box — that compression is the whole point of a shared axis.
{
    const half = { frameDiff: 10, valueDiff: 100, easing: linear };
    const next = neighbourCurveControlPoints("next", sel, half, bounds);
    near(next.p3[0], bounds.endX + width / 2, "a half-length neighbour spans half the width");
    near(next.p3[1], bounds.startY + height, "its value span is unaffected");
}

// Unmappable selections return null rather than dividing by zero. A hold segment has no
// value scale to map a neighbour's values through.
{
    const seg = { frameDiff: 20, valueDiff: 100, easing: linear };
    assert.equal(neighbourCurveControlPoints("next", { frameDiff: 20, valueDiff: 0 }, seg, bounds), null, "hold selection");
    assert.equal(neighbourCurveControlPoints("next", { frameDiff: 0, valueDiff: 100 }, seg, bounds), null, "zero-length selection");
    assert.equal(neighbourCurveControlPoints("next", sel, { frameDiff: 0, valueDiff: 5, easing: linear }, bounds), null, "zero-length neighbour");
    assert.equal(neighbourCurveControlPoints("next", sel, null, bounds), null, "missing neighbour");
}

// The refactor must not move the existing speed graph. Same samples, plus the divisor.
{
    const args = [0.42, 0.1, 0.58, 0.9, 50];
    const plain = sampleVelocityCurve(...args);
    const withMax = sampleVelocityCurveWithMax(...args);
    assert.deepEqual(withMax.samples, plain, "samples are unchanged by the refactor");
    assert.ok(withMax.max > 0, "a peak is reported");
    // The samples are the speeds divided by that peak, so the peak sample must be exactly 1.
    near(Math.max(...plain), 1, "normalised samples still peak at 1");
}

console.log("neighbours.test.mjs: ok");
