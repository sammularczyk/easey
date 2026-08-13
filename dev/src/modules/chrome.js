// UI chrome
// Segmented tab strip built from ui.Container, because ui.TabView exposes no
// styling at all and ui.Button has neither a selected state nor hover
// callbacks. Container has both, plus background colour and corner radius.

import { getTokens, blend } from './theme.js';

var TAB_HEIGHT = 25;
var STRIP_RADIUS = 5;
var TAB_RADIUS = 3;
var TAB_GAP = 2;
var STRIP_PADDING = 3;
var LABEL_SIZE = 12;
var ICON_GAP = 6;

var BAR_HEIGHT = 29;
var BAR_RADIUS = 4;
var BAR_PADDING = 3;
var BAR_GAP = 6;
var BUTTON_RADIUS = 2;

// The action buttons are always filled with the accent, so their glyph is a
// fixed dark rather than a theme colour that could match the accent.
var GLYPH_COLOR = "#000000";

/**
 * Path wrapper that flips the Y axis. ui.Draw is y-up (like Cavalry's scene)
 * but SVG is y-down, so tracing a Figma vector verbatim renders it mirrored.
 * Flipping here lets the builders below keep the exported SVG numbers as-is.
 * @param {Object} path - A cavalry.Path
 * @param {number} height - Height of the icon's viewBox
 */
function flipY(path, height) {
    return {
        moveTo: function(x, y) {
            path.moveTo(x, height - y);
        },
        lineTo: function(x, y) {
            path.lineTo(x, height - y);
        },
        cubicTo: function(x1, y1, x2, y2, x, y) {
            path.cubicTo(x1, height - y1, x2, height - y2, x, height - y);
        },
        close: function() {
            path.close();
        }
    };
}

// Icon outlines traced from the design's vectors, kept at their native viewBox
// coordinates. Each icon canvas is sized to the icon, so no offset maths is
// needed to centre them.
var ICONS = {
    value: {
        width: 11,
        height: 11,
        strokeWidth: 1.5,
        build: function(path) {
            path.moveTo(0.753, 9.75);
            path.cubicTo(7.676, 9.723, 2.269, 0.75, 9.753, 0.75);
        }
    },
    speed: {
        width: 11,
        height: 11,
        strokeWidth: 1.5,
        build: function(path) {
            path.moveTo(0.756, 9.689);
            path.cubicTo(4.128, 9.663, 2.878, 0.75, 5.349, 0.75);
            path.cubicTo(7.820, 0.75, 6.347, 9.75, 9.756, 9.75);
        }
    },
    get: {
        width: 24,
        height: 23,
        strokeWidth: 2,
        build: function(path) {
            path.moveTo(4.5, 11.702);
            path.lineTo(12.897, 11.702);
            path.moveTo(8.256, 16.344);
            path.lineTo(12.897, 11.702);
            path.lineTo(8.195, 7);
            path.moveTo(17.5, 17);
            path.lineTo(17.5, 6);
        }
    },
    // Same box as the get icon so both buttons lay out identically.
    // Mirrored horizontally: the design wraps this icon in scale-y(-1) plus a
    // 180 degree rotation, which composes to a horizontal flip. Without it the
    // tick's long arm lands on the left and it reads as a chevron.
    apply: {
        width: 24,
        height: 23,
        strokeWidth: 2,
        build: function(path) {
            path.moveTo(17.535, 7.363);
            path.lineTo(9.260, 15.637);
            path.lineTo(5.465, 11.842);
        }
    },
    presets: {
        width: 8,
        height: 11,
        filled: true,
        build: function(path) {
            path.moveTo(4.517, 0.097);
            path.cubicTo(4.672, -0.106, 4.995, 0.036, 4.951, 0.287);
            path.lineTo(4.347, 3.728);
            path.lineTo(7.595, 3.728);
            path.cubicTo(7.851, 3.728, 7.993, 4.024, 7.833, 4.224);
            path.lineTo(2.813, 10.510);
            path.cubicTo(2.645, 10.720, 2.310, 10.544, 2.388, 10.287);
            path.lineTo(3.570, 6.404);
            path.lineTo(0.306, 6.404);
            path.cubicTo(0.053, 6.404, -0.090, 6.114, 0.063, 5.914);
            path.close();
        }
    }
};

/**
 * Repaint an icon canvas. Icons are drawn rather than shipped as PNGs so they
 * can be recoloured per state — ui.Image has no tinting.
 * @param {Object} canvas - The ui.Draw element
 * @param {Object} icon - Entry from ICONS
 * @param {string} color - Icon colour, hex string
 * @param {string|null} backgroundColor - Must match whatever sits behind the
 *   canvas. Pass null to leave the canvas transparent, which is what lets a
 *   rounded parent Container show its corners instead of being painted over by
 *   this square canvas.
 */
function drawIcon(canvas, icon, color, backgroundColor) {
    canvas.clearPaths();

    if (backgroundColor) {
        canvas.setBackgroundColor(backgroundColor);
    }

    var path = new cavalry.Path();
    icon.build(flipY(path, icon.height));

    if (icon.filled) {
        canvas.addPath(path.toObject(), { "color": color, "stroke": false });
    } else {
        canvas.addPath(path.toObject(), {
            "color": color,
            "stroke": true,
            "strokeWidth": icon.strokeWidth
        });
    }

    canvas.redraw();
}

/**
 * Build an accent-filled action button with a drawn glyph.
 * The caller assigns onMousePress; hover is handled here. ui.ImageButton is
 * unusable for this — it cannot be tinted and has no hover callbacks.
 * @param {string} iconKey - Key into ICONS
 * @param {string} tooltip - Tooltip text
 * @returns {Object} A ui.Container
 */
export function buildIconButton(iconKey, tooltip) {
    var tokens = getTokens();
    var icon = ICONS[iconKey];
    // Needs to be a big step: a 20% lift on an already-bright accent is
    // invisible in practice.
    var hoverBackground = blend(tokens.accent, tokens.text, 0.4);

    var canvas = new ui.Draw();
    canvas.setSize(icon.width, icon.height);
    canvas.setFixedWidth(icon.width);
    canvas.setFixedHeight(icon.height);
    // The canvas covers the whole button, so without this it swallows the mouse
    // events and the Container never sees a hover or a click.
    canvas.setTransparentForMouseEvents(true);

    var layout = new ui.HLayout();
    layout.setMargins(0, 0, 0, 0);
    layout.setSpaceBetween(0);
    layout.add(canvas);

    var container = new ui.Container();
    container.setRadius(BUTTON_RADIUS, BUTTON_RADIUS, BUTTON_RADIUS, BUTTON_RADIUS);
    container.setSize(icon.width, icon.height);
    container.setFixedWidth(icon.width);
    container.setFixedHeight(icon.height);
    container.setLayout(layout);
    container.setToolTip(tooltip);
    // Enter/leave only fire once the Container is opted into hover events.
    container.useHoverEvents(true);

    function paint(background) {
        container.setBackgroundColor(background);
        // Transparent canvas so the container's rounded corners are visible.
        drawIcon(canvas, icon, GLYPH_COLOR, null);
    }

    container.onMouseEnter = function() {
        paint(hoverBackground);
    };
    container.onMouseLeave = function() {
        paint(tokens.accent);
    };

    paint(tokens.accent);

    return container;
}

/**
 * Build the composite bottom bar: leading button, divider, text field and
 * trailing button, all inside one rounded surface so they read as one control.
 * @param {Object} input - The ui.LineEdit
 * @param {Object} leadingButton - Widget placed at the left
 * @param {Object} trailingButton - Widget placed at the right
 * @returns {Object} A ui.Container
 */
export function buildBottomBar(input, leadingButton, trailingButton) {
    var tokens = getTokens();

    // Matching the field to its parent is what makes the group read as a single
    // control; the LineEdit's own frame is Qt-native and cannot be removed.
    input.setBackgroundColor(tokens.surface);
    input.setFontSize(LABEL_SIZE);

    var row = new ui.HLayout();
    row.setSpaceBetween(BAR_GAP);
    row.setMargins(BAR_PADDING, BAR_PADDING, BAR_PADDING, BAR_PADDING);
    row.add(leadingButton);
    row.add(input);
    row.add(trailingButton);

    var bar = new ui.Container();
    bar.setBackgroundColor(tokens.surface);
    bar.setRadius(BAR_RADIUS, BAR_RADIUS, BAR_RADIUS, BAR_RADIUS);
    bar.setFixedHeight(BAR_HEIGHT);
    bar.setLayout(row);

    return bar;
}

/**
 * Build the segmented tab strip.
 * @param {Array} tabs - [{label: string, icon: string}] where icon keys ICONS
 * @param {Function} onSelect - Called with the new index when a tab is clicked
 * @returns {Object} {widget, setSelected(index), selectedIndex()}
 */
export function buildTabStrip(tabs, onSelect) {
    var tokens = getTokens();
    var hoverBackground = blend(tokens.trough, tokens.surface, 0.5);

    var row = new ui.HLayout();
    row.setSpaceBetween(TAB_GAP);
    // Padding lives on the layout, not the Container's contents margins, so the
    // tabs sit visibly inset within the trough's rounded edge.
    row.setMargins(STRIP_PADDING, STRIP_PADDING, STRIP_PADDING, STRIP_PADDING);

    var entries = [];
    var selectedIndex = 0;

    function paint(index) {
        var entry = entries[index];
        var isSelected = index === selectedIndex;
        var background = isSelected ? tokens.surface : (entry.hovered ? hoverBackground : tokens.trough);
        var foreground = isSelected ? tokens.accent : tokens.textMuted;

        entry.container.setBackgroundColor(background);
        entry.label.setTextColor(isSelected ? tokens.text : tokens.textMuted);
        drawIcon(entry.canvas, entry.icon, foreground, background);
    }

    function paintAll() {
        for (var i = 0; i < entries.length; i++) {
            paint(i);
        }
    }

    for (var i = 0; i < tabs.length; i++) {
        var icon = ICONS[tabs[i].icon];

        var canvas = new ui.Draw();
        canvas.setSize(icon.width, icon.height);
        // So hovering directly over the icon or label still reaches the tab.
        canvas.setTransparentForMouseEvents(true);

        var label = new ui.Label(tabs[i].label);
        label.setFontSize(LABEL_SIZE);
        label.setTransparentForMouseEvents(true);

        // Stretch either side centres the icon and label within the tab.
        var content = new ui.HLayout();
        content.setSpaceBetween(ICON_GAP);
        content.setMargins(0, 0, 0, 0);
        content.addStretch();
        content.add(canvas);
        content.add(label);
        content.addStretch();

        var container = new ui.Container();
        container.setRadius(TAB_RADIUS, TAB_RADIUS, TAB_RADIUS, TAB_RADIUS);
        container.setFixedHeight(TAB_HEIGHT);
        container.setLayout(content);
        container.useHoverEvents(true);

        entries.push({
            container: container,
            canvas: canvas,
            label: label,
            icon: icon,
            hovered: false
        });

        row.add(container);
    }

    // Bound in a second pass so each closure captures its own index rather than
    // the shared loop variable.
    entries.forEach(function(entry, index) {
        entry.container.onMousePress = function(position, button) {
            if (index === selectedIndex) return;

            selectedIndex = index;
            paintAll();
            if (onSelect) onSelect(index);
        };
        entry.container.onMouseEnter = function() {
            entry.hovered = true;
            paint(index);
        };
        entry.container.onMouseLeave = function() {
            entry.hovered = false;
            paint(index);
        };
    });

    var strip = new ui.Container();
    strip.setBackgroundColor(tokens.trough);
    strip.setRadius(STRIP_RADIUS, STRIP_RADIUS, STRIP_RADIUS, STRIP_RADIUS);
    strip.setFixedHeight(TAB_HEIGHT + STRIP_PADDING * 2);
    strip.setLayout(row);

    paintAll();

    var compact = false;

    return {
        widget: strip,
        setSelected: function(index) {
            if (index < 0 || index >= entries.length) return;
            selectedIndex = index;
            paintAll();
        },
        selectedIndex: function() {
            return selectedIndex;
        },
        /**
         * Hide the labels and leave icons only, for windows too narrow to fit
         * the text. No-ops when already in the requested mode, so it is safe to
         * call on every resize event.
         * @param {boolean} state
         */
        setCompact: function(state) {
            if (state === compact) return;
            compact = state;

            for (var i = 0; i < entries.length; i++) {
                entries[i].label.setHidden(state);
            }
        },
        /**
         * Show or hide a single tab, for layouts that surface its page some
         * other way.
         * @param {number} index
         * @param {boolean} visible
         */
        setTabVisible: function(index, visible) {
            if (!entries[index]) return;
            entries[index].container.setHidden(!visible);
        }
    };
}
