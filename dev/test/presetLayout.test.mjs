// Locks the drop-slot arithmetic that stands in for hit-testing. It has to be
// right by construction: a press grabs the mouse, so nothing in the UI can tell
// us which row the cursor is over and there is no runtime check to fall back on.
import assert from 'node:assert/strict';
import { buildListGeometry, dropTargetAt, presetTop } from '../src/modules/presetLayout.js';

const metrics = {
    headerHeight: 30,
    placeholderHeight: 25,
    rowHeight: 35,
    separatorHeight: 1,
    tileBlockHeight: 100,
    tileSize: 60,
    tileGap: 8,
    gridLeft: 3
};

const libs = n => ({ presets: Array.from({ length: n }, (_, i) => ({ name: 'p' + i })) });

// ---- list mode geometry ----
const listSpec = { libraries: [libs(3), libs(0), libs(2)], isGrid: false, metrics };
const g = buildListGeometry(listSpec);

// Library 0: header 30, then 3 rows of 35 with 2 separators = 107.
assert.equal(g.blocks[0].contentTop, 30);
assert.equal(g.blocks[0].contentHeight, 3 * 35 + 2 * 1);
assert.equal(g.blocks[0].bottom, 137);
// Empty library falls back to the placeholder's height, not zero — the header
// and the "No presets yet" line still occupy space a drag can pass through.
assert.equal(g.blocks[1].contentHeight, 25);
assert.equal(g.blocks[1].contentTop, 167);
assert.equal(g.blocks[2].contentTop, 222);
assert.equal(g.totalHeight, 222 + 2 * 35 + 1);

// ---- list mode drop slots ----
const at = y => dropTargetAt(g, { x: 50, y }, listSpec);

// Upper half of the first row inserts before it; lower half inserts after.
assert.deepEqual(at(30 + 5), { libraryIndex: 0, slot: 0 });
assert.deepEqual(at(30 + 30), { libraryIndex: 0, slot: 1 });
// Between rows 1 and 2.
assert.deepEqual(at(30 + 36 + 30), { libraryIndex: 0, slot: 2 });
// Past the last row of library 0 clamps to its count rather than spilling into
// the next library — the block owns everything up to its own bottom.
assert.deepEqual(at(136), { libraryIndex: 0, slot: 3 });
// Above everything: first slot of the first library.
assert.deepEqual(at(-40), { libraryIndex: 0, slot: 0 });
// An empty library is always slot 0, wherever in its block you land.
assert.deepEqual(at(170), { libraryIndex: 1, slot: 0 });
assert.deepEqual(at(185), { libraryIndex: 1, slot: 0 });
// Below everything clamps into the last library's last slot.
assert.deepEqual(at(99999), { libraryIndex: 2, slot: 2 });

// ---- presetTop round-trips against the slot maths ----
// A preset's own top must read back as the slot before it, otherwise a drag that
// has not moved would compute a different slot and look like a change.
assert.equal(presetTop(g, 0, 0, listSpec), 30);
assert.equal(presetTop(g, 0, 2, listSpec), 30 + 2 * 36);
assert.deepEqual(at(presetTop(g, 0, 2, listSpec)), { libraryIndex: 0, slot: 2 });
assert.equal(presetTop(g, 2, 1, listSpec), 222 + 36);

// ---- grid mode ----
// Grid content height is measured by the host (a FlowLayout's wrapping is not
// predicted here), so it is supplied rather than derived.
const gridSpec = {
    libraries: [libs(5)], isGrid: true, metrics, columns: 3, contentHeights: [216]
};
const gg = buildListGeometry(gridSpec);
assert.equal(gg.blocks[0].contentHeight, 216);

const gat = (x, y) => dropTargetAt(gg, { x, y }, gridSpec);
const cellW = metrics.tileSize + metrics.tileGap;   // 68
const cellH = metrics.tileBlockHeight + metrics.tileGap; // 108

// First row, left edge -> slot 0; nearest-gap means past a tile's midpoint
// advances a column.
assert.deepEqual(gat(metrics.gridLeft, 30 + 5), { libraryIndex: 0, slot: 0 });
assert.deepEqual(gat(metrics.gridLeft + cellW, 30 + 5), { libraryIndex: 0, slot: 1 });
assert.deepEqual(gat(metrics.gridLeft + 2 * cellW, 30 + 5), { libraryIndex: 0, slot: 2 });
// Second visual row starts at slot 3 with 3 columns.
assert.deepEqual(gat(metrics.gridLeft, 30 + cellH + 5), { libraryIndex: 0, slot: 3 });
assert.deepEqual(gat(metrics.gridLeft + cellW, 30 + cellH + 5), { libraryIndex: 0, slot: 4 });
// Far right of a row cannot exceed the column count, and nothing can exceed the
// preset count — a 5-item library has no slot 6.
assert.deepEqual(gat(9999, 30 + 5), { libraryIndex: 0, slot: 3 });
assert.deepEqual(gat(9999, 30 + cellH + 5), { libraryIndex: 0, slot: 5 });
// Left of the grid clamps to the row's first slot rather than going negative.
assert.deepEqual(gat(-500, 30 + 5), { libraryIndex: 0, slot: 0 });

console.log('presetLayout: ok');
