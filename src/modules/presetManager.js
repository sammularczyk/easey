// Preset management module
// Functions for saving, loading, and managing easing presets

/**
 * Save a new preset
 * @param {Object} presets - Presets object to modify
 * @param {Object} currentEasing - Current easing values to save
 * @param {Function} onSave - Callback after saving (for updating UI)
 */
export function savePreset(presets, currentEasing, onSave) {
    try {
        var modal = new ui.Modal();
        var presetName = modal.showStringInput("Save Preset", "Enter preset name (max 30 chars):", "My Preset");
        
        if (presetName && presetName.trim() !== "") {
            if (presetName.length > 30) {
                console.log("Preset name too long. Please use 30 characters or less.");
                return;
            }
            
            presets[presetName] = {
                x1: currentEasing.x1,
                y1: currentEasing.y1,
                x2: currentEasing.x2,
                y2: currentEasing.y2
            };
            
            if (onSave) onSave();
        }
    } catch (e) {
        console.log("Error saving preset:", e.message);
    }
}

/**
 * Rename an existing preset
 * @param {Object} presets - Presets object to modify
 * @param {string} selectedPreset - Name of preset to rename
 * @param {Function} onRename - Callback after renaming (for updating UI)
 * @returns {string|null} New preset name or null if cancelled
 */
export function renamePreset(presets, selectedPreset, onRename) {
    if (!selectedPreset || selectedPreset === "Select a preset..." || selectedPreset === "---") {
        console.log("Please select a preset to rename");
        return null;
    }
    
    try {
        var modal = new ui.Modal();
        var newName = modal.showStringInput("Rename Preset", "Enter new name (max 30 chars):", selectedPreset);
        
        if (newName && newName.trim() !== "" && newName !== selectedPreset) {
            if (newName.length > 30) {
                console.log("Preset name too long. Please use 30 characters or less.");
                return null;
            }
            
            if (presets[newName]) {
                console.log("A preset with that name already exists");
                return null;
            }
            
            presets[newName] = presets[selectedPreset];
            delete presets[selectedPreset];
            
            if (onRename) onRename();
            
            return newName;
        }
    } catch (e) {
        console.log("Error renaming preset:", e.message);
    }
    
    return null;
}

/**
 * Delete a preset
 * @param {Object} presets - Presets object to modify
 * @param {string} selectedPreset - Name of preset to delete
 * @param {Function} onDelete - Callback after deleting (for updating UI)
 */
export function deletePreset(presets, selectedPreset, onDelete) {
    if (!selectedPreset || selectedPreset === "Select a preset..." || selectedPreset === "---") {
        console.log("Please select a preset to delete");
        return;
    }
    
    try {
        delete presets[selectedPreset];
        if (onDelete) onDelete();
    } catch (e) {
        console.log("Error deleting preset:", e.message);
    }
}

/**
 * Delete all presets
 * @param {Object} presets - Presets object to clear
 * @param {Function} onDelete - Callback after deleting (for updating UI)
 */
export function deleteAllPresets(presets, onDelete) {
    try {
        var allPresetNames = Object.keys(presets);
        
        if (allPresetNames.length === 0) {
            console.log("No presets to delete");
            return;
        }
        
        var modal = new ui.Modal();
        var confirmText = "Are you sure you want to delete ALL " + allPresetNames.length + " presets?\n\nThis action cannot be undone.";
        var result = modal.showConfirmation("Delete All Presets", confirmText);
        
        if (result) {
            for (var presetName in presets) {
                delete presets[presetName];
            }
            
            if (onDelete) onDelete();
            console.log("Deleted all " + allPresetNames.length + " presets");
        }
        
    } catch (e) {
        console.log("Error deleting all presets:", e.message);
    }
}

/**
 * Export presets to clipboard as JSON
 * @param {Object} presets - Presets object to export
 */
export function exportPresets(presets) {
    try {
        var presetsJson = JSON.stringify(presets, null, 2);
        api.setClipboardText(presetsJson);
    } catch (e) {
        console.log("Error exporting presets:", e.message);
    }
}

/**
 * Import presets from clipboard JSON
 * @param {Object} presets - Presets object to modify
 * @param {Function} onImport - Callback after importing (for updating UI)
 */
export function importPresets(presets, onImport) {
    try {
        var clipboardContent = api.getClipboardText();
        if (!clipboardContent) {
            console.log("No content in clipboard");
            return;
        }
        
        var importedPresets;
        try {
            importedPresets = JSON.parse(clipboardContent);
        } catch (e) {
            console.log("Clipboard content is not valid JSON");
            return;
        }
        
        if (typeof importedPresets !== 'object' || importedPresets === null) {
            console.log("Clipboard content is not a valid presets object");
            return;
        }
        
        // Merge presets
        for (var name in importedPresets) {
            presets[name] = importedPresets[name];
        }
        
        if (onImport) onImport();
        
    } catch (e) {
        console.log("Error importing presets:", e.message);
    }
}

/**
 * Save presets to preferences
 * @param {Object} presets - Presets object to save
 */
export function savePresetsToPreferences(presets) {
    try {
        api.setPreferenceObject("easey_presets", presets);
    } catch (e) {
        console.log("Could not save presets to preferences:", e.message);
    }
}

/**
 * Load presets from preferences
 * @param {Object} presets - Presets object to populate
 */
export function loadPresetsFromPreferences(presets) {
    try {
        if (api.hasPreferenceObject("easey_presets")) {
            var savedPresets = api.getPreferenceObject("easey_presets");
            if (savedPresets !== null && savedPresets !== undefined) {
                // Clear existing and copy saved
                for (var key in presets) {
                    delete presets[key];
                }
                for (var key in savedPresets) {
                    presets[key] = savedPresets[key];
                }
            }
        }
    } catch (e) {
        console.log("Could not load presets from preferences:", e.message);
    }
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
 * Populate preset dropdown with presets
 * @param {Object} dropdown - The ui.DropDown element
 * @param {Object} presets - Presets object
 */
export function populatePresetDropdown(dropdown, presets) {
    dropdown.clear();
    
    dropdown.addEntry("Select a preset...");
    dropdown.insertSeparator(1);
    
    var presetNames = Object.keys(presets);
    presetNames.sort(function(a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    
    for (var i = 0; i < presetNames.length; i++) {
        dropdown.addEntry(presetNames[i]);
    }
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
