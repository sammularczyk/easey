// Preset management module
// Functions for saving, loading, and managing easing presets

import { DEFAULT_PRESETS } from './constants.js';

// ============================================================================
// PRESET LIBRARIES
//
// Model: { libraries: [ { name, presets: [ {name, x1, y1, x2, y2} ] } ] }
//
// Ordered arrays rather than keyed objects, because libraries and presets are
// user-orderable and names are allowed to repeat. Entries are addressed by
// index and carry no id: the presets page is rebuilt from the model after every
// mutation, so an index is never held across a change.
// ============================================================================

var LIBRARIES_KEY = "easey_presets_v2";
var LEGACY_PRESETS_KEY = "easey_presets";
var DEFAULT_LIBRARY_NAME = "My Presets";
var MAX_NAME_LENGTH = 30;

/**
 * Wrap a flat {name: {x1,y1,x2,y2}} map into a single-library model.
 * @param {Object} flatPresets - Legacy preset map
 * @param {string} libraryName - Name for the wrapping library
 * @returns {Object} A libraries model
 */
export function buildLibrariesFromFlat(flatPresets, libraryName) {
    var names = Object.keys(flatPresets || {}).sort(function(a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });

    var presets = names.map(function(name) {
        var preset = flatPresets[name];
        return {
            name: name,
            x1: preset.x1,
            y1: preset.y1,
            x2: preset.x2,
            y2: preset.y2
        };
    });

    return { libraries: [{ name: libraryName, presets: presets }] };
}

function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
}

/**
 * Coerce a value read back from preferences into a valid model, dropping
 * anything malformed. Preferences are user-editable on disk, so a corrupt or
 * hand-edited blob must not take the whole panel down.
 * @param {Object} raw - Value from preferences
 * @returns {Object|null} A libraries model, or null if unusable
 */
export function normaliseLibraries(raw) {
    if (!raw || !Array.isArray(raw.libraries)) return null;

    var libraries = [];

    for (var i = 0; i < raw.libraries.length; i++) {
        var library = raw.libraries[i];
        if (!library || typeof library.name !== "string") continue;

        var presets = [];
        var rawPresets = Array.isArray(library.presets) ? library.presets : [];

        for (var j = 0; j < rawPresets.length; j++) {
            var preset = rawPresets[j];
            if (!preset || typeof preset.name !== "string") continue;
            if (!isFiniteNumber(preset.x1) || !isFiniteNumber(preset.y1)) continue;
            if (!isFiniteNumber(preset.x2) || !isFiniteNumber(preset.y2)) continue;

            presets.push({
                name: preset.name,
                x1: preset.x1,
                y1: preset.y1,
                x2: preset.x2,
                y2: preset.y2
            });
        }

        libraries.push({ name: library.name, presets: presets });
    }

    return libraries.length > 0 ? { libraries: libraries } : null;
}

/**
 * Load the libraries model, migrating older storage where needed.
 * The legacy key is deliberately left in place so an older Easey still opens.
 * @returns {Object} A libraries model
 */
export function loadLibraries() {
    try {
        if (api.hasPreferenceObject(LIBRARIES_KEY)) {
            var saved = normaliseLibraries(api.getPreferenceObject(LIBRARIES_KEY));
            if (saved) return saved;
        }

        if (api.hasPreferenceObject(LEGACY_PRESETS_KEY)) {
            var legacy = api.getPreferenceObject(LEGACY_PRESETS_KEY);
            if (legacy && Object.keys(legacy).length > 0) {
                return buildLibrariesFromFlat(legacy, DEFAULT_LIBRARY_NAME);
            }
        }
    } catch (e) {
        console.log("Could not load preset libraries:", e.message);
    }

    return buildLibrariesFromFlat(DEFAULT_PRESETS, DEFAULT_LIBRARY_NAME);
}

/**
 * Persist the libraries model.
 * @param {Object} model - A libraries model
 */
export function saveLibraries(model) {
    try {
        api.setPreferenceObject(LIBRARIES_KEY, model);
    } catch (e) {
        console.log("Could not save preset libraries:", e.message);
    }
}

/**
 * Prompt for a name, rejecting empty and over-long input.
 * @returns {string|null} Trimmed name, or null when cancelled or invalid
 */
function promptForName(title, message, initial) {
    var modal = new ui.Modal();
    var name = modal.showStringInput(title, message, initial);

    if (!name) return null;

    // Trim before measuring, so surrounding whitespace can't push an otherwise
    // acceptable name over the limit.
    var trimmed = name.trim();
    if (trimmed === "") return null;

    if (trimmed.length > MAX_NAME_LENGTH) {
        // A console line would leave the user staring at a menu that silently
        // did nothing.
        new ui.Modal().showMessage(
            title,
            "That name is " + trimmed.length + " characters. Please use " +
            MAX_NAME_LENGTH + " or less."
        );
        return null;
    }

    return trimmed;
}

function getLibrary(model, libraryIndex) {
    return model.libraries[libraryIndex] || null;
}

/**
 * @returns {boolean} Whether the model changed
 */
export function createLibrary(model) {
    var name = promptForName("New Library", "Enter library name (max 30 chars):", "My Library");
    if (!name) return false;

    model.libraries.push({ name: name, presets: [] });
    return true;
}

export function renameLibrary(model, libraryIndex) {
    var library = getLibrary(model, libraryIndex);
    if (!library) return false;

    var name = promptForName("Rename Library", "Enter new name (max 30 chars):", library.name);
    if (!name || name === library.name) return false;

    library.name = name;
    return true;
}

export function deleteLibrary(model, libraryIndex) {
    var library = getLibrary(model, libraryIndex);
    if (!library) return false;

    // Deleting the last library would leave nowhere to save a preset.
    if (model.libraries.length === 1) {
        console.log("Cannot delete the only library.");
        return false;
    }

    var modal = new ui.Modal();
    var confirmText = "Delete \"" + library.name + "\" and its " + library.presets.length +
        " preset(s)?\n\nThis action cannot be undone.";

    if (!modal.showConfirmation("Delete Library", confirmText)) return false;

    model.libraries.splice(libraryIndex, 1);
    return true;
}

/**
 * Write a library to a JSON file of the user's choosing.
 */
export function exportLibrary(model, libraryIndex) {
    var library = getLibrary(model, libraryIndex);
    if (!library) return;

    try {
        var path = ui.chooseFileToSave(library.name + ".json", "Easey Library (*.json)");
        if (!path) return;

        api.writeToFile(path, JSON.stringify(library, null, 2), true);
        console.log("Exported \"" + library.name + "\" to " + path);
    } catch (e) {
        console.log("Error exporting library:", e.message);
    }
}

/**
 * Append a library read from a JSON file. Accepts either a single exported
 * library or a whole exported model.
 * @returns {boolean} Whether the model changed
 */
export function importLibrary(model) {
    try {
        var path = ui.chooseFileToOpen("", "Easey Library (*.json)");
        if (!path) return false;

        var parsed = JSON.parse(api.readFromFile(path));
        var imported = normaliseLibraries(parsed.libraries ? parsed : { libraries: [parsed] });

        if (!imported) {
            console.log("That file does not contain any valid presets.");
            return false;
        }

        for (var i = 0; i < imported.libraries.length; i++) {
            model.libraries.push(imported.libraries[i]);
        }

        return true;
    } catch (e) {
        console.log("Error importing library:", e.message);
        return false;
    }
}

export function savePresetToLibrary(model, libraryIndex, currentEasing) {
    var library = getLibrary(model, libraryIndex);
    if (!library) return false;

    var name = promptForName("Save Preset", "Enter preset name (max 30 chars):", "My Preset");
    if (!name) return false;

    library.presets.push({
        name: name,
        x1: currentEasing.x1,
        y1: currentEasing.y1,
        x2: currentEasing.x2,
        y2: currentEasing.y2
    });

    return true;
}

export function renameLibraryPreset(model, libraryIndex, presetIndex) {
    var library = getLibrary(model, libraryIndex);
    if (!library || !library.presets[presetIndex]) return false;

    var preset = library.presets[presetIndex];
    var name = promptForName("Rename Preset", "Enter new name (max 30 chars):", preset.name);
    if (!name || name === preset.name) return false;

    preset.name = name;
    return true;
}

/**
 * Move a preset into another library, appending it at the end.
 * @returns {boolean} Whether the model changed
 */
export function movePresetToLibrary(model, libraryIndex, presetIndex, targetLibraryIndex) {
    var source = getLibrary(model, libraryIndex);
    var target = getLibrary(model, targetLibraryIndex);

    if (!source || !target || source === target) return false;
    if (!source.presets[presetIndex]) return false;

    target.presets.push(source.presets.splice(presetIndex, 1)[0]);
    return true;
}

export function deleteLibraryPreset(model, libraryIndex, presetIndex) {
    var library = getLibrary(model, libraryIndex);
    if (!library || !library.presets[presetIndex]) return false;

    var modal = new ui.Modal();
    var confirmText = "Delete the preset \"" + library.presets[presetIndex].name +
        "\"?\n\nThis action cannot be undone.";

    if (!modal.showConfirmation("Delete Preset", confirmText)) return false;

    library.presets.splice(presetIndex, 1);
    return true;
}

/**
 * Save apply on drag setting
 * @param {boolean} enabled - Whether apply on drag is enabled
 */
export function saveApplyOnDragSetting(enabled) {
    try {
        api.setPreferenceObject("easey_applyOnDrag", enabled);
    } catch (e) {
        console.log("Could not save apply on drag setting:", e.message);
    }
}

/**
 * Load apply on drag setting
 * @returns {boolean} Whether apply on drag is enabled
 */
export function loadApplyOnDragSetting() {
    try {
        if (api.hasPreferenceObject("easey_applyOnDrag")) {
            var saved = api.getPreferenceObject("easey_applyOnDrag");
            if (saved !== null && saved !== undefined) {
                return saved;
            }
        }
    } catch (e) {
        console.log("Could not load apply on drag setting:", e.message);
    }
    return false;
}

/**
 * Save automatic update check setting
 * @param {boolean} enabled - Whether the update check runs on launch
 */
export function saveUpdateCheckSetting(enabled) {
    try {
        api.setPreferenceObject("easey_checkForUpdates", enabled);
    } catch (e) {
        console.log("Could not save update check setting:", e.message);
    }
}

/**
 * Load automatic update check setting
 * @returns {boolean} Whether the update check runs on launch (default: true)
 */
export function loadUpdateCheckSetting() {
    try {
        if (api.hasPreferenceObject("easey_checkForUpdates")) {
            var saved = api.getPreferenceObject("easey_checkForUpdates");
            if (saved !== null && saved !== undefined) {
                return saved;
            }
        }
    } catch (e) {
        console.log("Could not load update check setting:", e.message);
    }
    return true;
}

/**
 * Save clamp identical values setting
 * @param {boolean} enabled - Whether clamping is enabled
 */
export function saveClampIdenticalSetting(enabled) {
    try {
        api.setPreferenceObject("easey_clampIdenticalValues", enabled);
    } catch (e) {
        console.log("Could not save clamp identical setting:", e.message);
    }
}

/**
 * Load clamp identical values setting
 * @returns {boolean} Whether clamping is enabled (default: true)
 */
export function loadClampIdenticalSetting() {
    try {
        if (api.hasPreferenceObject("easey_clampIdenticalValues")) {
            var saved = api.getPreferenceObject("easey_clampIdenticalValues");
            if (saved !== null && saved !== undefined) {
                return saved;
            }
        }
    } catch (e) {
        console.log("Could not load clamp identical setting:", e.message);
    }
    return true;
}

/**
 * Save the presets page layout
 * @param {string} layout - "list" or "grid"
 */
export function savePresetLayoutSetting(layout) {
    try {
        api.setPreferenceObject("easey_presetLayout", layout);
    } catch (e) {
        console.log("Could not save preset layout setting:", e.message);
    }
}

/**
 * Load the presets page layout
 * @returns {string} "list" or "grid" (default: "list")
 */
export function loadPresetLayoutSetting() {
    try {
        if (api.hasPreferenceObject("easey_presetLayout")) {
            var saved = api.getPreferenceObject("easey_presetLayout");
            if (saved === "list" || saved === "grid") {
                return saved;
            }
        }
    } catch (e) {
        console.log("Could not load preset layout setting:", e.message);
    }
    return "list";
}

/**
 * Remember that the banner for a given version was dismissed.
 * Stored per version so a later release surfaces the banner again.
 * @param {string} version - The version that was dismissed
 */
export function saveDismissedUpdate(version) {
    try {
        api.setPreferenceObject("easey_dismissedUpdate", version);
    } catch (e) {
        console.log("Could not save dismissed update:", e.message);
    }
}

/**
 * @returns {string|null} The dismissed version, or null
 */
export function loadDismissedUpdate() {
    try {
        if (api.hasPreferenceObject("easey_dismissedUpdate")) {
            var saved = api.getPreferenceObject("easey_dismissedUpdate");
            if (typeof saved === "string") return saved;
        }
    } catch (e) {
        console.log("Could not load dismissed update:", e.message);
    }
    return null;
}

/**
 * Save last selected tab to preferences
 * @param {number} tabIndex - Index of the selected tab
 */
export function saveLastSelectedTab(tabIndex) {
    try {
        api.setPreferenceObject("easey_lastSelectedTab", tabIndex);
    } catch (e) {
        console.log("Could not save last selected tab:", e.message);
    }
}

/**
 * Load last selected tab from preferences
 * @returns {number|null} Tab index or null if not saved
 */
export function loadLastSelectedTab() {
    try {
        if (api.hasPreferenceObject("easey_lastSelectedTab")) {
            var saved = api.getPreferenceObject("easey_lastSelectedTab");
            if (saved !== null && saved !== undefined) {
                return saved;
            }
        }
    } catch (e) {
        console.log("Could not load last selected tab:", e.message);
    }
    return null;
}

/**
 * Copy current curve to clipboard in cubic-bezier format
 * @param {Object} currentEasing - Current easing values
 */
export function copyCubicBezierToClipboard(currentEasing) {
    var text = "cubic-bezier(" + currentEasing.x1.toFixed(2) + ", " + 
               currentEasing.y1.toFixed(2) + ", " + 
               currentEasing.x2.toFixed(2) + ", " + 
               currentEasing.y2.toFixed(2) + ")";
    api.setClipboardText(text);
    console.log("Copied " + text + " to clipboard");
}
