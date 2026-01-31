// Easey - Advanced Cubic Bezier Easing Plugin for Cavalry
//
// INSTALLATION:
// 1. Save this file as "Easey.js" in your Cavalry scripts folder
// 2. Find the scripts folder via: Help > Show Scripts Folder (or Scripts > Show Scripts Folder)
// 3. Restart Cavalry or refresh the Scripts menu
// 4. Access via: Window > Scripts > Easey
//
// FEATURES:
// - Interactive bezier curve editor with visual handles
// - Shift+drag axis constraint for precise editing
// - Multi-attribute keyframe support (apply to multiple layers/properties at once)
// - Preset management with alphabetical sorting
// - Context menu integration for keyframe analysis
// - Persistent preset storage with proper deletion handling
//
// CAVALRY API DISCOVERIES & LESSONS LEARNED:
//
// 1. MODIFIER KEY DETECTION:
//    - Mouse event 'modifiers' parameter is undefined in Cavalry
//    - Solution: Use api.isShiftHeld(), api.isControlHeld() for reliable key detection
//    - api.isControlHeld() = Cmd on macOS, Control on Windows
//    - Speed Graph: Shift locks Y (X-only movement), Cmd/Ctrl mirrors handles
//    - Reference: https://docs.cavalry.scenegroup.co/tech-info/scripting/api-module/#isshiftheld
//
// 2. KEYFRAME SELECTION HANDLING:
//    - api.getSelectedKeyframes() returns object with full attribute paths as keys
//    - api.getAttributeFromKeyframeId() returns FULL path (e.g., "basicShape#1.position.x")
//    - Key insight: Match keyframe IDs to attribute paths using full paths, not partial
//
// 3. MULTI-ATTRIBUTE KEYFRAME PROCESSING:
//    - Can process keyframes across different layers and properties simultaneously
//    - Group by full attribute path, then process each group independently
//    - Each attribute group needs separate unlocking and easing application
//
// 4. HANDLE BOUNDS & CLICK DETECTION:
//    - Visual handle positions and click targets can desync when dragging outside bounds
//    - Solution: Clamp visual positions for both drawing AND click detection consistently
//    - Allow easing values beyond 0-1 range while keeping handles clickable
//
// 5. PRESET PERSISTENCE:
//    - Default presets get re-added on script reload unless properly handled
//    - Solution: Replace entire presets object with saved data, not merge
//    - Use api.setPreferenceObject() and api.getPreferenceObject() for persistence
//
// 6. AXIS CONSTRAINT IMPLEMENTATION:
//    - Calculate handle angle from proper origin points (cp1: 0,0 | cp2: 1,1)
//    - Snap coordinate to grid boundary, then constrain mouse movement to other axis
//    - Recalculate constraint direction when shift is re-pressed during same drag
//
// USAGE:
// 1. Select keyframes in the Graph Editor or Time Editor (supports multiple attributes)
// 2. Use the interactive graph to adjust easing curve
// 3. Hold Shift while dragging handles for axis-constrained movement
// 4. Click Apply to apply the easing to selected keyframes
// 5. Use Get button to extract easing from selected keyframes
// 6. Right-click preset area for context menu options
// 7. Use context menu items to copy keyframe duration, values, and easing info

// Import modules
import { DEFAULT_PRESETS, DEFAULT_EASING, GRAPH_CONFIG, DEFAULT_SPEED_EASING } from './modules/constants.js';
import { checkForUpdate } from './modules/updateChecker.js';
import { getCompositionFrameRate } from './modules/conversions.js';
import { drawCurve, drawSpeedCurve } from './modules/graphRenderer.js';
import { setupValueGraphHandlers, setupSpeedGraphHandlers } from './modules/mouseHandlers.js';
import { getEasingFromKeyframes, applyEasingToKeyframes, copyKeyframeDuration, copyKeyframeValues, copyAllKeyframeInfo } from './modules/keyframeOps.js';
import { 
    savePreset, renamePreset, deletePreset, deleteAllPresets,
    exportPresets, importPresets, savePresetsToPreferences, loadPresetsFromPreferences,
    saveApplyOnDragSetting, loadApplyOnDragSetting, saveLastSelectedTab, loadLastSelectedTab,
    populatePresetDropdown, copyCubicBezierToClipboard
} from './modules/presetManager.js';
import { initializeAssets, getAssetPath } from './modules/embeddedAssets.js';

// Initialize embedded assets (writes icons to temp folder if needed)
initializeAssets();

// Set the window title
ui.setTitle("Easey");

// Version info
var GITHUB_REPO = "sammularczyk/Easey";
var scriptName = "Easey";
var currentVersion = "1.1.0";

// Check for updates
checkForUpdate(GITHUB_REPO, scriptName, currentVersion);

// ============================================================================
// STATE
// ============================================================================

// Copy presets from defaults (so we can modify it)
var presets = Object.assign({}, DEFAULT_PRESETS);

// Current easing values
var currentEasing = Object.assign({}, DEFAULT_EASING);

// Speed graph state
var speedEasing = Object.assign({}, DEFAULT_SPEED_EASING);

// Graph dimensions (mutable for resize)
var graphWidth = GRAPH_CONFIG.width;
var graphHeight = GRAPH_CONFIG.height;
var graphPadding = GRAPH_CONFIG.padding;
var handleRadius = GRAPH_CONFIG.handleRadius;

// Speed graph dimensions
var speedGraphWidth = GRAPH_CONFIG.width;
var speedGraphHeight = GRAPH_CONFIG.height;
var speedGraphPadding = GRAPH_CONFIG.padding;
var speedHandleRadius = GRAPH_CONFIG.handleRadius;

// Drag state for value graph
var isDragging = false;
var dragHandle = null;
var dragStartPosition = null;
var dragStartEasing = null;
var axisConstraint = null;

// Drag state for speed graph
var speedDragging = false;
var speedDragHandle = null;

// Settings
var applyOnDragEnabled = false;

// Flags
var isUpdatingFromPreset = false;
var isUpdatingTextInput = false;
var isInitializingTab = false;

// ============================================================================
// UI ELEMENTS
// ============================================================================

// Create canvases
var graphCanvas = new ui.Draw();
graphCanvas.setSize(graphWidth, graphHeight);

var speedGraphCanvas = new ui.Draw();
speedGraphCanvas.setSize(speedGraphWidth, speedGraphHeight);

// Main action buttons
var applyButton = new ui.ImageButton(getAssetPath("icon-apply"));
applyButton.setToolTip("Apply easing");
applyButton.setImageSize(16,16);
applyButton.setSize(24, 24);

var getButton = new ui.ImageButton(getAssetPath("icon-get"));
getButton.setToolTip("Get easing from keyframes");
getButton.setImageSize(16,16);
getButton.setSize(24, 24);

// Context menu button for main actions
var mainContextButton = new ui.Button("⋯");
mainContextButton.setSize(18, 18);

// Text input for cubic bezier values
var bezierInput = new ui.LineEdit();
bezierInput.setText("0.25, 0.1, 0.25, 1.0");

// Preset dropdown
var presetList = new ui.DropDown();

// Context menu button for preset actions
var presetContextButton = new ui.ImageButton(getAssetPath("icon-settings"));
presetContextButton.setDrawStroke(false);
presetContextButton.setToolTip("Settings");
presetContextButton.setImageSize(16,16);
presetContextButton.setSize(18, 18);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Create shared state object for mouse handlers
var sharedState = {
    get currentEasing() { return currentEasing; },
    get speedEasing() { return speedEasing; },
    get isDragging() { return isDragging; },
    set isDragging(v) { isDragging = v; },
    get dragHandle() { return dragHandle; },
    set dragHandle(v) { dragHandle = v; },
    get dragStartPosition() { return dragStartPosition; },
    set dragStartPosition(v) { dragStartPosition = v; },
    get dragStartEasing() { return dragStartEasing; },
    set dragStartEasing(v) { dragStartEasing = v; },
    get axisConstraint() { return axisConstraint; },
    set axisConstraint(v) { axisConstraint = v; },
    get speedDragging() { return speedDragging; },
    set speedDragging(v) { speedDragging = v; },
    get speedDragHandle() { return speedDragHandle; },
    set speedDragHandle(v) { speedDragHandle = v; }
};

// Get current graph config
function getGraphConfig() {
    return {
        width: graphWidth,
        height: graphHeight,
        padding: graphPadding,
        handleRadius: handleRadius
    };
}

function getSpeedGraphConfig() {
    return {
        width: speedGraphWidth,
        height: speedGraphHeight,
        padding: speedGraphPadding,
        handleRadius: speedHandleRadius
    };
}

// Update text input with current easing values
function updateTextInput() {
    var x1 = (currentEasing.x1 !== undefined) ? currentEasing.x1 : 0.25;
    var y1 = (currentEasing.y1 !== undefined) ? currentEasing.y1 : 0.1;
    var x2 = (currentEasing.x2 !== undefined) ? currentEasing.x2 : 0.25;
    var y2 = (currentEasing.y2 !== undefined) ? currentEasing.y2 : 1.0;
    
    var text = x1.toFixed(3) + ", " + 
               y1.toFixed(3) + ", " + 
               x2.toFixed(3) + ", " + 
               y2.toFixed(3);
    
    isUpdatingTextInput = true;
    bezierInput.setText(text);
    isUpdatingTextInput = false;
}

// Parse text input and update curve
function updateFromTextInput() {
    try {
        var text = bezierInput.getText();
        var values = text.split(',').map(function(v) { return parseFloat(v.trim()); });
        
        if (values.length === 4 && values.every(function(v) { return !isNaN(v); })) {
            currentEasing.x1 = values[0];
            currentEasing.y1 = values[1];
            currentEasing.x2 = values[2];
            currentEasing.y2 = values[3];
            
            redrawGraphs();
        } else {
            console.log("Error: Invalid cubic bezier values");
        }
    } catch (e) {
        console.log("Error: Failed to parse cubic bezier values");
    }
}

// Redraw both graphs
function redrawGraphs() {
    drawCurve(graphCanvas, currentEasing, getGraphConfig());
    drawSpeedCurve(speedGraphCanvas, currentEasing, speedEasing, getSpeedGraphConfig());
}

// Save tab preference wrapper
function saveTabPreference() {
    if (!isInitializingTab) {
        saveLastSelectedTab(tabView.currentTab());
    }
}

// ============================================================================
// MOUSE HANDLERS
// ============================================================================

setupValueGraphHandlers({
    canvas: graphCanvas,
    state: sharedState,
    getConfig: getGraphConfig,
    onUpdate: function() {
        updateTextInput();
        redrawGraphs();
    },
    onDragEnd: function() {
        presetList.setText("Select a preset...");
        if (applyOnDragEnabled) {
            applyEasingToKeyframes(currentEasing);
        }
        saveTabPreference();
    }
});

setupSpeedGraphHandlers({
    canvas: speedGraphCanvas,
    state: sharedState,
    getConfig: getSpeedGraphConfig,
    onUpdate: function() {
        updateTextInput();
        redrawGraphs();
        if (applyOnDragEnabled) {
            applyEasingToKeyframes(currentEasing);
        }
    },
    onDragEnd: function() {
        presetList.setText("Select a preset...");
        saveTabPreference();
    }
});

// ============================================================================
// CONTEXT MENUS
// ============================================================================

function showPresetContextMenu() {
    ui.clearContextMenu();

    var separatorItem = { name: "" };
    
    ui.addMenuItem({
        name: "Save Preset...",
        onMouseRelease: function() {
            savePreset(presets, currentEasing, function() {
                populatePresetDropdown(presetList, presets);
                savePresetsToPreferences(presets);
            });
        }
    });
    
    ui.addMenuItem(separatorItem);
    
    ui.addMenuItem({
        name: "Rename Preset",
        onMouseRelease: function() {
            var selectedPreset = presetList.getText();
            var newName = renamePreset(presets, selectedPreset, function() {
                populatePresetDropdown(presetList, presets);
                savePresetsToPreferences(presets);
            });
            if (newName) {
                presetList.setText(newName);
            }
        }
    });
    
    ui.addMenuItem({
        name: "Delete Preset",
        onMouseRelease: function() {
            var selectedPreset = presetList.getText();
            deletePreset(presets, selectedPreset, function() {
                populatePresetDropdown(presetList, presets);
                savePresetsToPreferences(presets);
            });
        }
    });
    
    ui.addMenuItem(separatorItem);

    ui.addMenuItem({
        name: "Import Presets",
        onMouseRelease: function() {
            importPresets(presets, function() {
                savePresetsToPreferences(presets);
                populatePresetDropdown(presetList, presets);
            });
        }
    });
    
    ui.addMenuItem({
        name: "Copy All Presets",
        onMouseRelease: function() {
            exportPresets(presets);
        }
    });
    
    ui.addMenuItem({
        name: "Delete All Presets",
        onMouseRelease: function() {
            deleteAllPresets(presets, function() {
                populatePresetDropdown(presetList, presets);
                savePresetsToPreferences(presets);
            });
        }
    });

    ui.addMenuItem(separatorItem);
    
    ui.addMenuItem({
        name: "Copy Current Curve to Clipboard",
        onMouseRelease: function() {
            copyCubicBezierToClipboard(currentEasing);
        }
    });
    
    ui.addMenuItem({
        name: "Copy Keyframe Duration in ms",
        onMouseRelease: function() {
            copyKeyframeDuration();
        }
    });
    
    ui.addMenuItem({
        name: "Copy Keyframe Values",
        onMouseRelease: function() {
            copyKeyframeValues();
        }
    });
    
    ui.addMenuItem({
        name: "Copy All Keyframe Info",
        onMouseRelease: function() {
            copyAllKeyframeInfo();
        }
    });

    ui.addMenuItem(separatorItem);
    
    ui.addMenuItem({
        name: "Apply when dragging handles" + (applyOnDragEnabled ? " ✓" : ""),
        onMouseRelease: function() {
            applyOnDragEnabled = !applyOnDragEnabled;
            saveApplyOnDragSetting(applyOnDragEnabled);
        }
    });

    ui.addMenuItem(separatorItem);

    ui.addMenuItem({
        name: "Easey Version " + currentVersion,
        enabled: false
    });
    ui.addMenuItem({
        name: "By Canva Creative Team",
        enabled: false
    });
    ui.addMenuItem({
        name: "Get updates and more plugins...",
        enabled: true,
        onMouseRelease: function() {
            api.openURL("https://canvacreative.team/motion");
        }
    });

    ui.showContextMenu();
}

// ============================================================================
// BUTTON EVENT HANDLERS
// ============================================================================

applyButton.onClick = function() {
    applyEasingToKeyframes(currentEasing);
    saveTabPreference();
};

getButton.onClick = function() {
    if (getEasingFromKeyframes(currentEasing)) {
        updateTextInput();
        redrawGraphs();
    }
    saveTabPreference();
};

mainContextButton.onClick = function() {
    showPresetContextMenu();
};

presetContextButton.onClick = function() {
    showPresetContextMenu();
};

bezierInput.onValueChanged = function() {
    if (isUpdatingTextInput) return;
    
    updateFromTextInput();
    
    if (!isUpdatingFromPreset) {
        presetList.setText("Select a preset...");
    }
};

presetList.onValueChanged = function() {
    var selectedPreset = presetList.getText();
    
    if (selectedPreset === "Select a preset...") return;
    
    if (selectedPreset && presets[selectedPreset]) {
        isUpdatingFromPreset = true;
        var preset = presets[selectedPreset];
        
        currentEasing.x1 = preset.x1;
        currentEasing.y1 = preset.y1;
        currentEasing.x2 = preset.x2;
        currentEasing.y2 = preset.y2;
        
        updateTextInput();
        redrawGraphs();
        isUpdatingFromPreset = false;
        
        saveTabPreference();
    }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

// Load saved presets
loadPresetsFromPreferences(presets);

// Load apply on drag setting
applyOnDragEnabled = loadApplyOnDragSetting();

// Populate preset dropdown
populatePresetDropdown(presetList, presets);

// ============================================================================
// UI LAYOUT
// ============================================================================

// Create main layout
var mainLayout = new ui.VLayout();
mainLayout.setSpaceBetween(0);
mainLayout.setMargins(3, 3, 3, 3);

// Preset row
var presetRow = new ui.HLayout();
presetRow.add(presetList);
presetRow.add(presetContextButton);
presetRow.setMargins(0, 4, 0, 0);

// Create TabView
var tabView = new ui.TabView();

// VALUE TAB
var valueTabLayout = new ui.VLayout();
valueTabLayout.setSpaceBetween(0);
valueTabLayout.setMargins(0, 0, 0, 0);
valueTabLayout.add(graphCanvas);
valueTabLayout.addStretch();

// SPEED TAB
var speedTabLayout = new ui.VLayout();
speedTabLayout.setSpaceBetween(0);
speedTabLayout.setMargins(0, 0, 0, 0);
speedTabLayout.add(speedGraphCanvas);
speedTabLayout.addStretch();

// Add tabs (Speed first to match After Effects workflow)
tabView.add("Speed", speedTabLayout);
tabView.add("Value", valueTabLayout);

// Add to main layout
mainLayout.add(tabView);

// Button row
var buttonRow = new ui.HLayout();
buttonRow.add(getButton);
buttonRow.add(bezierInput);
buttonRow.add(applyButton);
buttonRow.setSpaceBetween(4);
buttonRow.setMargins(0, 4, 0, 0);
mainLayout.add(buttonRow);
mainLayout.add(presetRow);
mainLayout.addStretch();

// Add to UI
ui.add(mainLayout);
ui.setBackgroundColor(ui.getThemeColor("Base"));

// Initialize display
updateTextInput();
redrawGraphs();

// Tab change handler
tabView.onTabChanged = function() {
    redrawGraphs();
    saveTabPreference();
};

// Window size
ui.setMinimumWidth(graphWidth);
ui.setMinimumHeight(graphHeight + 60);

// Resize handler
ui.onResize = function() {
    var newWidth = ui.size().width;
    var newHeight = ui.size().height;
    
    var controlsHeight = 90;
    var margin = 10;
    
    var newGraphWidth = Math.max(150, newWidth - margin);
    var newGraphHeight = Math.max(150, newHeight - controlsHeight);
    
    graphWidth = newGraphWidth;
    graphHeight = newGraphHeight;
    speedGraphWidth = newGraphWidth;
    speedGraphHeight = newGraphHeight;
    
    graphCanvas.setSize(graphWidth, graphHeight);
    speedGraphCanvas.setSize(speedGraphWidth, speedGraphHeight);
    
    redrawGraphs();
};

// Show window
ui.show();

// Restore last selected tab
isInitializingTab = true;
var savedTab = loadLastSelectedTab();
if (savedTab !== null) {
    tabView.setTab(savedTab);
}

// Reset init flag after delay
var initTimerCallback = {
    onTimeout: function() {
        isInitializingTab = false;
    }
};
var initTimer = new api.Timer(initTimerCallback);
initTimer.setInterval(100);
initTimer.setRepeating(false);
initTimer.start();
