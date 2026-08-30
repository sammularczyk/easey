// Vertical geometry of the presets list, and the drop target for a drag.
// Pure maths, no Cavalry calls, so it runs under node in test/presetLayout.test.mjs.
//
// Why this has to exist: reordering by drag needs to know which slot the cursor
// is over, and the widget API cannot help. Widgets expose no geometry query, and
// a press grabs the mouse — so during a drag no other row reports being hovered
// (measured: onMouseEnter fires 0 times on a sibling while a button is held).
// The only signal is onMouseMove on the pressed widget, which does keep firing
// and does report positions outside its own bounds. So the list's geometry is
// reconstructed here from the same constants that built it.

/**
 * Lay the list out vertically, one block per library.
 *
 * @param {Object} spec
 * @param {Array} spec.libraries - [{presets: []}], only lengths are read
 * @param {boolean} spec.isGrid - Grid mode packs presets into rows of tiles
 * @param {Object} spec.metrics - Fixed heights, see presetsPage
 * @param {Array<number>} [spec.contentHeights] - Grid mode: measured height of
 *        each library's tile block, since a FlowLayout's wrapping is measured by
 *        the host rather than predicted here
 * @param {number} [spec.columns] - Grid mode: tiles per row
 * @returns {{totalHeight:number, blocks:Array}}
 */
export function buildListGeometry(spec) {
    var m = spec.metrics;
    var blocks = [];
    var y = 0;

    for (var i = 0; i < spec.libraries.length; i++) {
        var count = spec.libraries[i].presets.length;
        var top = y;
        var contentTop = y + m.headerHeight;
        var contentHeight;

        if (count === 0) {
            contentHeight = m.placeholderHeight;
        } else if (spec.isGrid) {
            contentHeight = (spec.contentHeights && spec.contentHeights[i]) || 0;
        } else {
            // One separator between each pair of rows, none before the first.
            contentHeight = count * m.rowHeight + (count - 1) * m.separatorHeight;
        }

        blocks.push({
            libraryIndex: i,
            top: top,
            contentTop: contentTop,
            contentHeight: contentHeight,
            bottom: contentTop + contentHeight,
            count: count
        });

        y = contentTop + contentHeight;
    }

    return { totalHeight: y, blocks: blocks };
}

/**
 * Which library block a y falls in. A y above the first block or below the last
 * clamps to that block, so a drag beyond either end still has a target — the
 * gesture plainly means "the top" or "the bottom".
 */
function blockAt(geometry, y) {
    var blocks = geometry.blocks;
    if (blocks.length === 0) return null;

    for (var i = 0; i < blocks.length; i++) {
        if (y < blocks[i].bottom) return blocks[i];
    }
    return blocks[blocks.length - 1];
}

/**
 * The slot a point would drop into.
 *
 * Slots are insertion gaps, not items: 0 is before the first preset and `count`
 * is after the last, which is exactly what movePreset's `toIndex` expects. The
 * half-pitch offset means the nearest gap wins rather than the row being
 * pointed at, so dropping on a row's lower half puts the preset after it.
 *
 * @param {Object} geometry - From buildListGeometry
 * @param {{x:number, y:number}} point - In list coordinates, y measured DOWN
 *        from the top of the list content
 * @param {Object} spec - The same spec handed to buildListGeometry
 * @returns {{libraryIndex:number, slot:number}|null}
 */
export function dropTargetAt(geometry, point, spec) {
    var block = blockAt(geometry, point.y);
    if (!block) return null;

    var m = spec.metrics;
    var withinContent = point.y - block.contentTop;

    if (block.count === 0) return { libraryIndex: block.libraryIndex, slot: 0 };

    if (spec.isGrid) {
        var columns = Math.max(1, spec.columns || 1);
        var cellWidth = m.tileSize + m.tileGap;
        var cellHeight = m.tileBlockHeight + m.tileGap;

        var row = Math.floor(withinContent / cellHeight);
        row = Math.max(0, row);

        // Nearest vertical gap between tiles, so a drop lands beside the tile
        // the cursor is closest to rather than inside it.
        var column = Math.floor((point.x - m.gridLeft + cellWidth / 2) / cellWidth);
        column = Math.max(0, Math.min(columns, column));

        return {
            libraryIndex: block.libraryIndex,
            slot: clampSlot(row * columns + column, block.count)
        };
    }

    var pitch = m.rowHeight + m.separatorHeight;
    var slot = Math.floor((withinContent + pitch / 2) / pitch);

    return { libraryIndex: block.libraryIndex, slot: clampSlot(slot, block.count) };
}

function clampSlot(slot, count) {
    if (!(slot > 0)) return 0;
    return Math.min(slot, count);
}

/**
 * Where a preset's own top edge sits, in the same list coordinates dropTargetAt
 * uses. The drag needs this to turn "moved N px from the press point" into an
 * absolute position, since the press only reports a position within its own row.
 * Returns null in grid mode, where the caller derives the tile origin from its
 * index instead.
 */
export function presetTop(geometry, libraryIndex, presetIndex, spec) {
    var block = null;
    for (var i = 0; i < geometry.blocks.length; i++) {
        if (geometry.blocks[i].libraryIndex === libraryIndex) block = geometry.blocks[i];
    }
    if (!block || spec.isGrid) return null;

    var m = spec.metrics;
    return block.contentTop + presetIndex * (m.rowHeight + m.separatorHeight);
}
