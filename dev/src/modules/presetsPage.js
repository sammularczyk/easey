// Presets page
// A scrolling list of preset libraries, built from ui.Container rows rather
// than ui.List: List has no section headers, no per-row drawing and no control
// over selection colour, none of which the design can do without.

import { getTokens, blend } from './theme.js';
import { drawCurveThumbnail, drawPresetTile } from './graphRenderer.js';

var ROW_HEIGHT = 35;
var ROW_RADIUS = 5;
var ROW_PADDING = 3;
var THUMBNAIL_SIZE = 20;
var LABEL_SIZE = 14;
var HEADER_SIZE = 11;
var HEADER_TOP_MARGIN = 12;
var MENU_WIDTH = 18;

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

        row.onMousePress = function(position, button) {
            if (button === "right") {
                config.onPresetMenu(libraryIndex, presetIndex);
                return;
            }

            config.onSelect(libraryIndex, presetIndex, preset);
        };
        row.onMouseEnter = function() {
            row.setBackgroundColor(hoverBackground);
            menu.setColor(tokens.textMuted);
        };
        row.onMouseLeave = function() {
            row.setBackgroundColor(restingBackground);
            menu.setColor(restingBackground);
        };

        return row;
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

        tile.onMousePress = function(position, button) {
            if (button === "right") {
                config.onPresetMenu(libraryIndex, presetIndex);
                return;
            }

            config.onSelect(libraryIndex, presetIndex, preset);
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

        return header;
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

        listLayout.clear();

        for (var i = 0; i < model.libraries.length; i++) {
            var library = model.libraries[i];
            listLayout.add(buildLibraryHeader(library, i, tokens));

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
                listLayout.add(emptyRow);
                continue;
            }

            if (isGrid) {
                // FlowLayout reflows its children by available width, so the
                // column count follows the window without being computed.
                var grid = new ui.FlowLayout(TILE_GAP, TILE_GAP);
                grid.setSpaceBetween(TILE_GAP);
                grid.setMargins(ROW_PADDING, 0, ROW_PADDING, 8);

                for (var g = 0; g < library.presets.length; g++) {
                    grid.add(buildPresetTile(i, library.presets[g], g, tokens, selection));
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

                listLayout.add(gridHost);
                continue;
            }

            for (var j = 0; j < library.presets.length; j++) {
                if (j > 0) listLayout.add(buildSeparator(tokens));
                listLayout.add(buildPresetRow(i, library.presets[j], j, tokens, selection));
            }
        }

        // Keeps libraries packed at the top instead of the layout sharing the
        // spare height out between them.
        listLayout.addStretch();
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
