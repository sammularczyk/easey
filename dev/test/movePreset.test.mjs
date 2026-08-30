// movePreset backs drag-reordering, where the drop slot comes from a cursor
// position — so the cases that matter are the ones geometry produces: dropping
// past the end, dropping on yourself, and dragging between libraries.
import assert from 'node:assert/strict';
import { movePreset, movePresetToLibrary } from '../src/modules/presetManager.js';

function model() {
    return {
        libraries: [
            { name: 'A', presets: [{ name: 'a0' }, { name: 'a1' }, { name: 'a2' }] },
            { name: 'B', presets: [{ name: 'b0' }] },
            { name: 'Empty', presets: [] }
        ]
    };
}
const names = (m, i) => m.libraries[i].presets.map(p => p.name);

// Reorder down. toIndex is the post-removal slot, so moving a0 to slot 2 in a
// 3-item list puts it last — the intuitive result of dragging to the bottom.
let m = model();
assert.equal(movePreset(m, 0, 0, 0, 2), true);
assert.deepEqual(names(m, 0), ['a1', 'a2', 'a0']);

// Reorder up.
m = model();
assert.equal(movePreset(m, 0, 2, 0, 0), true);
assert.deepEqual(names(m, 0), ['a2', 'a0', 'a1']);

// Adjacent swap, the most common drag.
m = model();
assert.equal(movePreset(m, 0, 0, 0, 1), true);
assert.deepEqual(names(m, 0), ['a1', 'a0', 'a2']);

// Dropped back where it started: no change, and false so the caller skips a
// save and a full widget rebuild.
m = model();
assert.equal(movePreset(m, 0, 1, 0, 1), false);
assert.deepEqual(names(m, 0), ['a0', 'a1', 'a2']);

// Dragged past the last row. Clamped to "last" rather than rejected, because a
// cursor below the list is a real gesture meaning exactly that.
m = model();
assert.equal(movePreset(m, 0, 0, 0, 99), true);
assert.deepEqual(names(m, 0), ['a1', 'a2', 'a0']);

// Negative slot clamps to first, for a drag above the top row.
m = model();
assert.equal(movePreset(m, 0, 2, 0, -5), true);
assert.deepEqual(names(m, 0), ['a2', 'a0', 'a1']);

// Across libraries, into a specific slot rather than appended.
m = model();
assert.equal(movePreset(m, 0, 1, 1, 0), true);
assert.deepEqual(names(m, 0), ['a0', 'a2']);
assert.deepEqual(names(m, 1), ['a1', 'b0']);

// Into an empty library — the drop target has no rows to measure against.
m = model();
assert.equal(movePreset(m, 0, 0, 2, 0), true);
assert.deepEqual(names(m, 0), ['a1', 'a2']);
assert.deepEqual(names(m, 2), ['a0']);

// Missing preset and missing library both refuse rather than throw.
m = model();
assert.equal(movePreset(m, 0, 99, 1, 0), false);
assert.equal(movePreset(m, 0, 0, 99, 0), false);
assert.equal(movePreset(m, 99, 0, 0, 0), false);
assert.deepEqual(names(m, 0), ['a0', 'a1', 'a2']);

// movePresetToLibrary now delegates to movePreset; it must still append, and
// still refuse a same-library move.
m = model();
assert.equal(movePresetToLibrary(m, 0, 0, 1), true);
assert.deepEqual(names(m, 1), ['b0', 'a0']);
m = model();
assert.equal(movePresetToLibrary(m, 0, 0, 0), false);
assert.deepEqual(names(m, 0), ['a0', 'a1', 'a2']);

console.log('movePreset: ok');
