// Theme tokens
// Maps the Easey design's colour roles onto Cavalry's UI theme, so the UI
// follows a theme change instead of hardcoding the mock's greys.
//
// ui.getThemeColor only exposes 16 base swatches and the docs warn it "will not
// provide all the colors in the UI", so each role names the closest swatch and
// carries the design's hex as a fallback.

// Hexes from the Figma design, used when a theme key is unavailable.
var FALLBACK = {
    windowBg: "#373737",
    surface: "#292929",
    trough: "#444444",
    rowSelected: "#272727",
    separator: "#4b4b4b",
    grid: "#2e2e2e",
    text: "#f1f1f1",
    textMuted: "#7d7d7d",
    accent: "#3ddc84"
};

function themeColor(name, fallback) {
    try {
        var color = ui.getThemeColor(name);
        return (typeof color === "string" && color.charAt(0) === "#") ? color : fallback;
    } catch (e) {
        return fallback;
    }
}

/**
 * Resolve the design's colour roles against the current Cavalry theme.
 * Call per draw/build rather than caching — the user can switch theme.
 * @returns {Object} token name -> hex string
 */
export function getTokens() {
    var windowBg = themeColor("Base", FALLBACK.windowBg);
    var text = themeColor("Text", FALLBACK.text);

    return {
        windowBg: windowBg,
        // Derived rather than taken from AlternateBase, which is *lighter* than
        // Base in Cavalry's dark theme. The design wants recessed controls to
        // read as sunk into the window, so this must be reliably darker.
        surface: blend(windowBg, "#000000", 0.28),
        // The graphs sit flush with the window rather than on their own panel.
        plotBg: windowBg,
        // Raised above the window, so it goes the other way.
        trough: blend(windowBg, "#ffffff", 0.06),
        // rowSelected and grid both track the "Dark" swatch, so they resolve
        // to the same value whenever the theme provides one; only their
        // fallbacks differ, for the case where that key is unavailable.
        rowSelected: themeColor("Dark", FALLBACK.rowSelected),
        separator: themeColor("Midlight", FALLBACK.separator),
        grid: themeColor("Dark", FALLBACK.grid),
        // The curve tracks Text rather than a hardcoded white, so it stays
        // visible on light themes.
        curve: text,
        text: text,
        // Derived, not a theme key: every muted-enough swatch (Mid, Midlight)
        // risks matching whatever background it sits on, and an exact match
        // makes the text invisible. Fading Text toward the window guarantees
        // contrast on any theme.
        textMuted: blend(text, windowBg, 0.45),
        accent: themeColor("Accent1", FALLBACK.accent)
    };
}

function channels(hex) {
    var h = String(hex).replace("#", "");
    return [
        parseInt(h.substr(0, 2), 16),
        parseInt(h.substr(2, 2), 16),
        parseInt(h.substr(4, 2), 16)
    ];
}

/**
 * Mix two hex colours. Any alpha byte on the inputs is ignored.
 * @param {string} fromHex - hex string, 6 or 8 digits
 * @param {string} toHex - hex string, 6 or 8 digits
 * @param {number} t - 0 returns fromHex, 1 returns toHex
 * @returns {string} 6-digit hex string
 */
export function blend(fromHex, toHex, t) {
    var from = channels(fromHex);
    var to = channels(toHex);
    var amount = Math.max(0, Math.min(1, t));
    var out = "#";

    for (var i = 0; i < 3; i++) {
        var value = Math.round(from[i] + (to[i] - from[i]) * amount);
        value = Math.max(0, Math.min(255, value));
        out += (value < 16 ? "0" : "") + value.toString(16);
    }

    return out;
}
