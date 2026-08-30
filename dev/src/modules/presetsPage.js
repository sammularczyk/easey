// Presets page
// A scrolling list of preset libraries, built from ui.Container rows rather
// than ui.List: List has no section headers, no per-row drawing and no control
// over selection colour, none of which the design can do without.

import { getTokens, blend } from './theme.js';
import { drawCurveThumbnail, drawPresetTile } from './graphRenderer.js';
import { buildListGeometry, dropTargetAt, presetTop } from './presetLayout.js';

var ROW_HEIGHT = 35;
var ROW_RADIUS = 5;
var ROW_PADDING = 3;
var THUMBNAIL_SIZE = 20;
var LABEL_SIZE = 14;
var HEADER_SIZE = 11;
var HEADER_TOP_MARGIN = 12;
var MENU_WIDTH = 18;

// Approximate rendered line height for an 11px label, since the UI font isn't
// exposed to scripts and cavalry.measureText needs one. Used only to size the
// fixed-height hosts below (~1.3x the font size, a typical single-line box).
var LABEL_LINE_HEIGHT = 14;

// A layout (HLayout/VLayout) cannot take a fixed height itself, so the header
// is hosted in a Container the same way the tile grid already is below. The
// value matches what the header currently renders as: its own top+bottom
// margins around one line of HEADER_SIZE text.
var HEADER_HEIGHT = HEADER_TOP_MARGIN + 4 + LABEL_LINE_HEIGHT; // 12 + 4 + 14 = 30

// Same trick for the empty-library placeholder row: its own margins (4 top,
// 8 bottom) around one line of HEADER_SIZE text.
var PLACEHOLDER_HEIGHT = 4 + 8 + LABEL_LINE_HEIGHT; // 4 + 8 + 14 = 26

// The smallest cursor movement (px, in the widget's own raw coordinates) that
// turns a press into a drag rather than a click.
var DRAG_THRESHOLD = 4;

// Grid layout, traced from the design. TILE_MIN is the design's tile size and
// the floor for how small tiles may get; they grow to divide the available
// width evenly, up to TILE_MAX.
var TILE_MIN = 48;
var TILE_MAX = 88;
var TILE_MAX_COLUMNS = 6;
var TILE_RADIUS = 5;
var TILE_GAP = 8;
var TILE_LABEL_SIZE = 10;
var TILE_LABEL_GAP = 6;
var TILE_LABEL_LINES = 2;
// Approximate rendered line height for a 10px label (see LABEL_LINE_HEIGHT).
var TILE_LABEL_LINE_HEIGHT = 13;

/**
 * A tile's total height including its label, so it can be given a fixed
 * height (needed for both layout and for the drag geometry to know it).
 * @param {number} size - Tile edge length in px
 * @returns {number}
 */
function computeTileBlockHeight(size) {
    return size + TILE_LABEL_GAP + TILE_LABEL_LINES * TILE_LABEL_LINE_HEIGHT;
}

// Rough advance width per character as a fraction of font size. Only used to
// decide where to truncate — cavalry.measureText needs a font family and style,
// and the UI font is not exposed to scripts.
var CHAR_WIDTH_RATIO = 0.55;

// Leaves room for the scroll bar so the last column never lands under it.
var SCROLLBAR_ALLOWANCE = 14;

/**
 * Shorten a name to fit the tile's two label lines, with an ellipsis.
 * @param {string} name - Preset name
 * @param {number} tileSize - Tile edge length in px
 * @returns {string}
 */
function truncateToTile(name, tileSize) {
    var perLine = Math.max(4, Math.floor(tileSize / (TILE_LABEL_SIZE * CHAR_WIDTH_RATIO)));
    var limit = perLine * TILE_LABEL_LINES;

    if (name.length <= limit) return name;

    return name.slice(0, Math.max(1, limit - 1)).trim() + "…";
}

/**
 * A "..." affordance that opens a context menu.
 * @param {Function} onOpen - Called when clicked
 * @param {Object} tokens - Theme tokens
 * @returns {Object} {widget, setColor}
 */
function buildMenuButton(onOpen, tokens) {
    var label = new ui.Label("⋯");
    label.setTextColor(tokens.textMuted);
    label.setAlignment(1);
    label.setTransparentForMouseEvents(true);

    var layout = new ui.HLayout();
    layout.setMargins(0, 0, 0, 0);
    layout.add(label);

    var container = new ui.Container();
    container.setFixedWidth(MENU_WIDTH);
    container.setLayout(layout);
    container.onMousePress = function(position, button) {
        onOpen();
    };

    return {
        widget: container,
        // Rows hide their menu by colouring it to match the row rather than
        // calling setHidden: a hidden widget receives no mouse events, so it
        // could never be hovered back into view, and removing it from the
        // layout would shift the row's contents on every hover.
        setColor: function(color) {
            label.setTextColor(color);
        }
    };
}

/**
 * Build the presets page.
 * @param {Object} config - Callbacks and model access
 * @param {Function} config.getModel - Returns the libraries model
 * @param {Function} config.getSelection - Returns {libraryIndex, presetIndex}
 * @param {Function} config.onSelect - (libraryIndex, presetIndex, preset)
 * @param {Function} config.onApply - (preset) on double click
 * @param {Function} config.onLibraryMenu - (libraryIndex)
 * @param {Function} config.onPresetMenu - (libraryIndex, presetIndex)
 * @param {Function} config.onReorder - (fromLibraryIndex, fromIndex, toLibraryIndex, toIndex)
 *        called on drag-release with the slot dropTargetAt landed on
 * @returns {Object} {widget, refresh}
 */
export function createPresetsPage(config) {
    var availableWidth = 0;
    var tileSize = TILE_MIN;

    // Fit as many minimum-width tiles as the page allows, then share the
    // leftover evenly between them so the grid has no ragged right edge.
    function computeTileSize() {
        if (availableWidth <= 0) return TILE_MIN;

        var usable = availableWidth - ROW_PADDING * 2 - SCROLLBAR_ALLOWANCE;
        if (usable < TILE_MIN) return TILE_MIN;

        // Capped, otherwise a wide window just keeps adding minimum-width
        // columns and the tiles never actually grow.
        var columns = Math.max(1, Math.floor((usable + TILE_GAP) / (TILE_MIN + TILE_GAP)));
        columns = Math.min(columns, TILE_MAX_COLUMNS);

        var size = Math.floor((usable - TILE_GAP * (columns - 1)) / columns);

        return Math.max(TILE_MIN, Math.min(TILE_MAX, size));
    }

    var listLayout = new ui.VLayout();
    listLayout.setSpaceBetween(0);
    listLayout.setMargins(0, 0, 0, 0);

    var scrollView = new ui.ScrollView();
    scrollView.setLayout(listLayout);

    // ---- Drag-to-reorder state ----
    //
    // A press grabs the mouse (measured: sibling onMouseEnter fires 0 times
    // during a drag), so the only usable signal is onMouseMove on the widget
    // that was pressed, and it keeps firing with positions well outside that
    // widget's own bounds. There is also no insert/removeAt on VLayout, so
    // widgets cannot be shuffled live during a drag — this only recomputes the
    // drop target and paints feedback onto widgets that already exist. The
    // actual move happens once, on release, via config.onReorder.
    //
    // geometryState is rebuilt every refresh() and is only ever read from a
    // mouse handler on a currently-live widget, so it is never stale: nothing
    // refreshes while a drag is in progress (refresh() destroys every widget,
    // and touching a destroyed one is undefined behaviour).
    var geometryState = null; // {geometry, spec}
    var currentTokens = null;
    var rowRefs = [];        // [libraryIndex][presetIndex] -> {widget, restingBg}
    var tileRefs = [];       // [libraryIndex][presetIndex] -> widget
    var separatorRefs = [];  // [libraryIndex][gapIndex] -> widget, gapIndex k sits between rows k and k+1
    var currentFeedback = null; // {type:'separator'|'rowBg'|'tileBorder', widget, restore}

    function clearDropFeedback() {
        if (!currentFeedback) return;

        if (currentFeedback.type === 'separator') {
            currentFeedback.widget.setBackgroundColor(currentTokens.separator);
        } else if (currentFeedback.type === 'rowBg') {
            currentFeedback.widget.setBackgroundColor(currentFeedback.restore);
        } else if (currentFeedback.type === 'tileBorder') {
            currentFeedback.widget.setBorder();
        }

        currentFeedback = null;
    }

    /**
     * Paint feedback for a drop target computed from dropTargetAt. List mode
     * recolours the separator sitting in that gap; a gap at either end of a
     * library has no separator (they only exist between rows), so the
     * boundary row's own background is blended instead. Grid mode borders
     * the tile currently occupying the slot.
     */
    function applyDropFeedback(target) {
        clearDropFeedback();
        if (!target) return;

        if (geometryState.spec.isGrid) {
            var tiles = tileRefs[target.libraryIndex];
            if (!tiles || tiles.length === 0) return;

            var tileIndex = Math.min(target.slot, tiles.length - 1);
            var tile = tiles[tileIndex];
            tile.setBorder(currentTokens.accent, 2);
            currentFeedback = { type: 'tileBorder', widget: tile };
            return;
        }

        var rows = rowRefs[target.libraryIndex];
        if (!rows || rows.length === 0) return; // empty library: nothing to highlight

        var count = rows.length;
        if (target.slot > 0 && target.slot < count) {
            var separator = separatorRefs[target.libraryIndex][target.slot - 1];
            if (!separator) return;
            separator.setBackgroundColor(currentTokens.accent);
            currentFeedback = { type: 'separator', widget: separator };
        } else {
            var boundaryIndex = target.slot === 0 ? 0 : count - 1;
            var boundaryRow = rows[boundaryIndex];
            boundaryRow.widget.setBackgroundColor(blend(currentTokens.windowBg, currentTokens.accent, 0.25));
            currentFeedback = { type: 'rowBg', widget: boundaryRow.widget, restore: boundaryRow.restingBg };
        }
    }

    /**
     * Wires press/move/release for one row or tile. `getWidgetHeight` and
     * `getAbsolutePoint` differ between list rows and grid tiles, since list
     * mode derives a row's top from presetTop while grid mode derives a
     * tile's own left/top from its index and the column count.
     */
    function attachDragHandlers(widget, libraryIndex, presetIndex, getAbsolutePoint, onClick) {
        var pressState = null;

        return {
            // Called for a left/other-button press only — right-click opens a
            // menu instead and never starts a drag; callers branch on button
            // before reaching this.
            onPress: function(position) {
                pressState = { x: position.x, y: position.y, dragging: false };
            },
            onMove: function(position) {
                if (!pressState) return;

                if (!pressState.dragging) {
                    var movedX = Math.abs(position.x - pressState.x);
                    var movedY = Math.abs(position.y - pressState.y);
                    if (movedX <= DRAG_THRESHOLD && movedY <= DRAG_THRESHOLD) return;

                    pressState.dragging = true;
                    widget.setBorder(currentTokens.accent, 1);
                }

                var point = getAbsolutePoint(position);
                if (!point) return;

                var target = dropTargetAt(geometryState.geometry, point, geometryState.spec);
                applyDropFeedback(target);
            },
            onRelease: function(position) {
                if (!pressState) return;

                var dragged = pressState.dragging;
                // Cleared before either callback runs: both rebuild the list,
                // which destroys this widget, and touching it after that is
                // undefined behaviour.
                pressState = null;

                if (!dragged) {
                    // A press that never moved is a click. Selecting here rather
                    // than on press is what makes dragging possible at all:
                    // onSelect refreshes both pages, and a refresh during a
                    // press would delete the very widget still receiving the
                    // move and release events.
                    if (onClick) onClick();
                    return;
                }

                widget.setBorder();
                clearDropFeedback();

                var point = getAbsolutePoint(position);
                var target = point && dropTargetAt(geometryState.geometry, point, geometryState.spec);
                if (target) config.onReorder(libraryIndex, presetIndex, target.libraryIndex, target.slot);
            }
        };
    }

    var pageLayout = new ui.VLayout();
    pageLayout.setSpaceBetween(0);
    pageLayout.setMargins(0, 0, 0, 0);
    pageLayout.add(scrollView);
    // Pins the fixed-height scroll area to the top. Without it the layout
    // centres it, which reads as presets floating in mid-air.
    pageLayout.addStretch();

    function buildPresetRow(libraryIndex, preset, presetIndex, tokens, selection) {
        var isSelected = selection.libraryIndex === libraryIndex &&
                         selection.presetIndex === presetIndex;

        var thumbnail = new ui.Draw();
        thumbnail.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
        thumbnail.setFixedWidth(THUMBNAIL_SIZE);
        thumbnail.setFixedHeight(THUMBNAIL_SIZE);
        thumbnail.setTransparentForMouseEvents(true);
        drawCurveThumbnail(thumbnail, preset, THUMBNAIL_SIZE, isSelected ? tokens.accent : tokens.textMuted);

        var label = new ui.Label(preset.name);
        label.setFontSize(LABEL_SIZE);
        label.setTextColor(tokens.text);
        label.setTransparentForMouseEvents(true);

        var menu = buildMenuButton(function() {
            config.onPresetMenu(libraryIndex, presetIndex);
        }, tokens);

        var content = new ui.HLayout();
        content.setSpaceBetween(10);
        content.setMargins(ROW_PADDING, 0, ROW_PADDING, 0);
        content.add(thumbnail);
        content.add(label);
        content.addStretch();
        content.add(menu.widget);

        var restingBackground = isSelected ? tokens.rowSelected : tokens.windowBg;
        var hoverBackground = isSelected
            ? tokens.rowSelected
            : blend(tokens.windowBg, tokens.text, 0.07);

        var row = new ui.Container();
        row.setFixedHeight(ROW_HEIGHT);
        row.setRadius(ROW_RADIUS, ROW_RADIUS, ROW_RADIUS, ROW_RADIUS);
        row.setLayout(content);
        row.setBackgroundColor(restingBackground);
        // Enter/leave only fire once the Container is opted into hover events.
        row.useHoverEvents(true);
        // The name is elided when the panel is too narrow to fit it.
        row.setToolTip(preset.name);

        // The menu only shows on hover, so at rest it is painted the row's own
        // colour rather than hidden.
        menu.setColor(restingBackground);

        // List mode: this row's own top comes straight from presetTop, since
        // rows share one fixed height and geometryState already knows it.
        var drag = attachDragHandlers(row, libraryIndex, presetIndex, function(position) {
            var top = presetTop(geometryState.geometry, libraryIndex, presetIndex, geometryState.spec);
            if (top == null) return null;
            return { x: position.x, y: top + (ROW_HEIGHT - position.y) };
        }, function() {
            config.onSelect(libraryIndex, presetIndex, preset);
        });

        row.onMousePress = function(position, button) {
            if (button === "right") {
                config.onPresetMenu(libraryIndex, presetIndex);
                return;
            }

            drag.onPress(position);
        };
        row.onMouseMove = function(position) {
            drag.onMove(position);
        };
        row.onMouseRelease = function(position) {
            drag.onRelease(position);
        };
        row.onMouseEnter = function() {
            row.setBackgroundColor(hoverBackground);
            menu.setColor(tokens.textMuted);
        };
        row.onMouseLeave = function() {
            row.setBackgroundColor(restingBackground);
            menu.setColor(restingBackground);
        };

        return { widget: row, restingBg: restingBackground };
    }

    /**
     * A grid tile: rounded thumbnail with the preset's name beneath. The whole
     * tile applies the preset, except the "..." pill in the bottom-right, which
     * is painted into the canvas and hit-tested here.
     */
    function buildPresetTile(libraryIndex, preset, presetIndex, tokens, selection) {
        var isSelected = selection.libraryIndex === libraryIndex &&
                         selection.presetIndex === presetIndex;
        var hovered = false;
        // Captured once at build time rather than read from the outer
        // `tileSize` in handlers below: it can only change between refreshes
        // (never mid-drag), but pinning it here means this tile's own drag
        // maths can never disagree with the size it was actually built at.
        var tileBlockHeight = computeTileBlockHeight(tileSize);

        var canvas = new ui.Draw();
        canvas.setSize(tileSize, tileSize);
        canvas.setFixedWidth(tileSize);
        canvas.setFixedHeight(tileSize);
        canvas.setTransparentForMouseEvents(true);

        var thumbnail = new ui.Container();
        thumbnail.setRadius(TILE_RADIUS, TILE_RADIUS, TILE_RADIUS, TILE_RADIUS);
        thumbnail.setFixedWidth(tileSize);
        thumbnail.setFixedHeight(tileSize);
        thumbnail.setTransparentForMouseEvents(true);

        var thumbnailLayout = new ui.HLayout();
        thumbnailLayout.setMargins(0, 0, 0, 0);
        thumbnailLayout.setSpaceBetween(0);
        thumbnailLayout.add(canvas);
        thumbnail.setLayout(thumbnailLayout);

        var label = new ui.Label(truncateToTile(preset.name, tileSize));
        label.setFontSize(TILE_LABEL_SIZE);
        label.setTextColor(isSelected ? tokens.text : tokens.textMuted);
        label.setFixedWidth(tileSize);
        label.setTransparentForMouseEvents(true);

        var content = new ui.VLayout();
        content.setSpaceBetween(TILE_LABEL_GAP);
        content.setMargins(0, 0, 0, 0);
        content.add(thumbnail);
        content.add(label);

        var tile = new ui.Container();
        tile.setFixedWidth(tileSize);
        // Needed so buildListGeometry's tileBlockHeight matches the tile the
        // grid actually renders (see computeTileBlockHeight).
        tile.setFixedHeight(tileBlockHeight);
        tile.setLayout(content);
        tile.useHoverEvents(true);
        // The full name stays reachable when the label had to be shortened. It
        // lives on the tile, not the label: the label is transparent for mouse
        // events, so a tooltip there would never fire.
        tile.setToolTip(preset.name);

        function paint() {
            thumbnail.setBackgroundColor(isSelected
                ? blend(tokens.surface, tokens.accent, 0.25)
                : hovered
                    ? blend(tokens.surface, tokens.accent, 0.07)
                    : tokens.surface);
            drawPresetTile(canvas, preset, tileSize, tokens);
        }

        // Grid mode: this tile's own left/top come from its index, the column
        // count and the cell pitch — there is no presetTop equivalent here,
        // since presetLayout returns null for grid (the caller derives tile
        // origin itself, per its own doc comment).
        var drag = attachDragHandlers(tile, libraryIndex, presetIndex, function(position) {
            var spec = geometryState.spec;
            var block = null;
            for (var b = 0; b < geometryState.geometry.blocks.length; b++) {
                if (geometryState.geometry.blocks[b].libraryIndex === libraryIndex) {
                    block = geometryState.geometry.blocks[b];
                }
            }
            if (!block) return null;

            var columns = Math.max(1, spec.columns || 1);
            var cellWidth = spec.metrics.tileSize + spec.metrics.tileGap;
            var cellHeight = spec.metrics.tileBlockHeight + spec.metrics.tileGap;
            var row = Math.floor(presetIndex / columns);
            var column = presetIndex % columns;

            var left = spec.metrics.gridLeft + column * cellWidth;
            var top = block.contentTop + row * cellHeight;

            return { x: left + position.x, y: top + (tileBlockHeight - position.y) };
        }, function() {
            config.onSelect(libraryIndex, presetIndex, preset);
        });

        tile.onMousePress = function(position, button) {
            if (button === "right") {
                config.onPresetMenu(libraryIndex, presetIndex);
                return;
            }

            drag.onPress(position);
        };
        tile.onMouseMove = function(position) {
            drag.onMove(position);
        };
        tile.onMouseRelease = function(position) {
            drag.onRelease(position);
        };

        tile.onMouseEnter = function() {
            hovered = true;
            paint();
        };
        tile.onMouseLeave = function() {
            hovered = false;
            paint();
        };

        paint();

        return tile;
    }

    function buildLibraryHeader(library, libraryIndex, tokens) {
        var label = new ui.Label(library.name.toUpperCase());
        label.setFontSize(HEADER_SIZE);
        label.setTextColor(tokens.textMuted);
        label.setTransparentForMouseEvents(true);

        var header = new ui.HLayout();
        header.setMargins(ROW_PADDING, HEADER_TOP_MARGIN, ROW_PADDING, 4);
        header.add(label);
        header.addStretch();
        // Library menus stay visible; only preset rows reveal theirs on hover.
        header.add(buildMenuButton(function() {
            config.onLibraryMenu(libraryIndex);
        }, tokens).widget);

        // A layout cannot take a fixed height itself, so it is hosted in a
        // Container — the same trick the tile grid uses below. Needed so
        // HEADER_HEIGHT (the constant the drag geometry assumes) is what
        // this actually renders as.
        var host = new ui.Container();
        host.setFixedHeight(HEADER_HEIGHT);
        host.setLayout(header);
        return host;
    }

    function buildSeparator(tokens) {
        var separator = new ui.Container();
        separator.setBackgroundColor(tokens.separator);
        separator.setFixedHeight(1);
        return separator;
    }

    /**
     * Rebuild the whole list from the model.
     *
     * Everything is recreated from scratch: layout.clear() deletes its children
     * outright and the docs are explicit that touching anything added before a
     * clear is undefined behaviour, so no widget may be cached across a
     * refresh.
     */
    function refresh() {
        var tokens = getTokens();
        var model = config.getModel();
        var selection = config.getSelection();
        var isGrid = config.getLayout() === "grid";

        currentTokens = tokens;
        currentFeedback = null; // widgets it pointed at are about to be destroyed
        rowRefs = [];
        tileRefs = [];
        separatorRefs = [];

        var contentHeights = [];
        var columns = 1;

        listLayout.clear();

        for (var i = 0; i < model.libraries.length; i++) {
            var library = model.libraries[i];
            listLayout.add(buildLibraryHeader(library, i, tokens));
            rowRefs[i] = [];
            tileRefs[i] = [];
            separatorRefs[i] = [];

            if (library.presets.length === 0) {
                var empty = new ui.Label("No presets yet");
                empty.setFontSize(HEADER_SIZE);
                empty.setTextColor(tokens.textMuted);
                empty.setTransparentForMouseEvents(true);

                // Hosted in a layout rather than added bare, for the same reason
                // the tile grid is hosted in a fixed-height Container below: a
                // bare widget in this VLayout absorbs the window's leftover
                // height instead of leaving it to the trailing stretch, which
                // spreads the libraries apart. An HLayout sizes to its contents,
                // and carries the inset the way buildLibraryHeader does.
                var emptyRow = new ui.HLayout();
                emptyRow.setMargins(ROW_PADDING, 4, ROW_PADDING, 8);
                emptyRow.add(empty);
                emptyRow.addStretch();

                // Same fixed-height-host trick as the header, so PLACEHOLDER_HEIGHT
                // (what the drag geometry assumes this row occupies) is real.
                var placeholderHost = new ui.Container();
                placeholderHost.setFixedHeight(PLACEHOLDER_HEIGHT);
                placeholderHost.setLayout(emptyRow);
                listLayout.add(placeholderHost);
                continue;
            }

            if (isGrid) {
                // FlowLayout reflows its children by available width, so the
                // column count follows the window without being computed.
                var grid = new ui.FlowLayout(TILE_GAP, TILE_GAP);
                grid.setSpaceBetween(TILE_GAP);
                grid.setMargins(ROW_PADDING, 0, ROW_PADDING, 8);

                for (var g = 0; g < library.presets.length; g++) {
                    var tile = buildPresetTile(i, library.presets[g], g, tokens, selection);
                    tileRefs[i][g] = tile;
                    grid.add(tile);
                }

                // A FlowLayout has no height of its own, so a tall window hands
                // it the leftover space and the tiles drift apart. Hosting it in
                // a Container fixed to the height it actually needs pins the
                // rows together and leaves the slack to the trailing stretch.
                var gridHost = new ui.Container();
                gridHost.setLayout(grid);

                var gridWidth = Math.max(TILE_MIN, availableWidth - ROW_PADDING * 2);
                var gridHeight = grid.getHeightForWidth(gridWidth);
                if (gridHeight > 0) gridHost.setFixedHeight(gridHeight);

                contentHeights[i] = gridHeight;
                // The column count FlowLayout will actually land on for this
                // width and tile size — measured from the same gridWidth used
                // above, not re-derived from computeTileSize's own (slightly
                // different) width budget.
                columns = Math.max(1, Math.floor((gridWidth + TILE_GAP) / (tileSize + TILE_GAP)));

                listLayout.add(gridHost);
                continue;
            }

            for (var j = 0; j < library.presets.length; j++) {
                if (j > 0) {
                    var separator = buildSeparator(tokens);
                    separatorRefs[i][j - 1] = separator;
                    listLayout.add(separator);
                }
                var built = buildPresetRow(i, library.presets[j], j, tokens, selection);
                rowRefs[i][j] = built;
                listLayout.add(built.widget);
            }
        }

        // Keeps libraries packed at the top instead of the layout sharing the
        // spare height out between them.
        listLayout.addStretch();

        var spec = {
            libraries: model.libraries,
            isGrid: isGrid,
            metrics: {
                headerHeight: HEADER_HEIGHT,
                placeholderHeight: PLACEHOLDER_HEIGHT,
                rowHeight: ROW_HEIGHT,
                separatorHeight: 1,
                tileBlockHeight: computeTileBlockHeight(tileSize),
                tileSize: tileSize,
                tileGap: TILE_GAP,
                gridLeft: ROW_PADDING
            },
            contentHeights: contentHeights,
            columns: columns
        };
        geometryState = { geometry: buildListGeometry(spec), spec: spec };
    }

    return {
        widget: pageLayout,
        refresh: refresh,
        /**
         * Bound the scrolling area's height.
         * @param {number} height - Height in px
         */
        // ScrollView has setFixedHeight of its own. It cannot be wrapped in a
        // Container — like PageView, hosting it that way stops it rendering.
        // Left unbounded it grows to its content, and inside a PageView that
        // inflates every page, since a PageView takes its largest page's
        // height whichever tab is showing.
        setViewportHeight: function(height) {
            if (height > 0) scrollView.setFixedHeight(height);
        },
        /**
         * Tell the page how much width it has. Rebuilds only when this changes
         * the tile size, so ordinary resize events cost nothing.
         * @param {number} width - Page width in px
         */
        setAvailableWidth: function(width) {
            if (width === availableWidth) return;
            availableWidth = width;

            var next = computeTileSize();
            if (next === tileSize) return;

            tileSize = next;
            if (config.getLayout() === "grid") refresh();
        }
    };
}
