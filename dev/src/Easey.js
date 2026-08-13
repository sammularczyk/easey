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
import { getEasingFromKeyframes, applyEasingToKeyframes, fixHoldPaths, setClampHoldsEnabled, copyKeyframeDuration, copyKeyframeValues, copyAllKeyframeInfo } from './modules/keyframeOps.js';
import { 
    savePreset, renamePreset, deletePreset, deleteAllPresets,
    exportPresets, importPresets, savePresetsToPreferences, loadPresetsFromPreferences,
    saveApplyOnDragSetting, loadApplyOnDragSetting,
    saveClampIdenticalSetting, loadClampIdenticalSetting,
    saveUpdateCheckSetting, loadUpdateCheckSetting,
    saveLastSelectedTab, loadLastSelectedTab,
    populatePresetDropdown, copyCubicBezierToClipboard
} from './modules/presetManager.js';
import { initializeAssets, getAssetPath } from './modules/embeddedAssets.js';
import { BUILD_ID } from './modules/buildInfo.js';
import { buildTabStrip, buildIconButton, buildBottomBar } from './modules/chrome.js';
import { getTokens } from './modules/theme.js';

// Initialize embedded assets (writes icons to temp folder if needed)
initializeAssets();

// Set the window title
ui.setTitle("Easey");

// Version info
var GITHUB_REPO = "sammularczyk/Easey";
var scriptName = "Easey";
var currentVersion = "1.5.1";

// Check for updates (unless the user turned it off)
var updateCheckEnabled = loadUpdateCheckSetting();
if (updateCheckEnabled) {
    checkForUpdate(GITHUB_REPO, scriptName, currentVersion);
}

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

// Hover state, drives the handle grow affordance on each graph
var hoveredHandle = null;
var speedHoveredHandle = null;

// Window width below which the tab strip drops its labels and shows icons only
var TAB_LABEL_MIN_WIDTH = 240;

// Settings
var applyOnDragEnabled = false;
var clampHoldsEnabled = true;

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
// Without this, onMouseMove only fires while a button is held, so handles
// would have no hover affordance.
graphCanvas.useHoverEvents(true);

var speedGraphCanvas = new ui.Draw();
speedGraphCanvas.setSize(speedGraphWidth, speedGraphHeight);
speedGraphCanvas.useHoverEvents(true);

// Main action buttons
// Drawn rather than ImageButtons so they can carry the accent fill and a hover
// state; ui.ImageButton offers neither.
var applyButton = buildIconButton("apply", "Apply easing");
var getButton = buildIconButton("get", "Get easing from keyframes");

// Text input for cubic bezier values
var bezierInput = new ui.LineEdit();
bezierInput.setText("0.25, 0.1, 0.25, 1.0");

// Preset dropdown
var presetList = new ui.DropDown();

// Context menu button for preset actions
var presetContextButton = new ui.ImageButton(getAssetPath("icon-settings"));
presetContextButton.setDrawStroke(false);
// ImageButton always paints a background; matching the window is the only way
// to make it disappear.
presetContextButton.setBackgroundColor(getTokens().windowBg);
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
    set speedDragHandle(v) { speedDragHandle = v; },
    get hoveredHandle() { return hoveredHandle; },
    set hoveredHandle(v) { hoveredHandle = v; },
    get speedHoveredHandle() { return speedHoveredHandle; },
    set speedHoveredHandle(v) { speedHoveredHandle = v; }
};

// Get current graph config
function getGraphConfig() {
    return {
        width: graphWidth,
        height: graphHeight,
        padding: graphPadding,
        handleRadius: handleRadius,
        hoveredHandle: hoveredHandle
    };
}

function getSpeedGraphConfig() {
    return {
        width: speedGraphWidth,
        height: speedGraphHeight,
        padding: speedGraphPadding,
        handleRadius: speedHandleRadius,
        hoveredHandle: speedHoveredHandle
    };
}

// Round to 3 decimals, then drop trailing zeros: 0.500 -> 0.5, 1.000 -> 1.
// parseFloat also normalises -0 to 0.
function formatBezierValue(value) {
    return String(parseFloat(value.toFixed(3)));
}

// Update text input with current easing values
function updateTextInput() {
    var x1 = (currentEasing.x1 !== undefined) ? currentEasing.x1 : 0.25;
    var y1 = (currentEasing.y1 !== undefined) ? currentEasing.y1 : 0.1;
    var x2 = (currentEasing.x2 !== undefined) ? currentEasing.x2 : 0.25;
    var y2 = (currentEasing.y2 !== undefined) ? currentEasing.y2 : 1.0;
    
    var text = [x1, y1, x2, y2].map(formatBezierValue).join(", ");
    
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
        saveLastSelectedTab(pageView.currentPage());
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
    },
    onHoverChange: function() {
        // Only the hovered canvas needs repainting, and hover must not touch
        // the text input or trigger apply-on-drag the way onUpdate does.
        drawCurve(graphCanvas, currentEasing, getGraphConfig());
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
    },
    onHoverChange: function() {
        drawSpeedCurve(speedGraphCanvas, currentEasing, speedEasing, getSpeedGraphConfig());
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

    ui.addMenuItem({
        name: "Automatically clamp paths" + (clampHoldsEnabled ? " ✓" : ""),
        onMouseRelease: function() {
            clampHoldsEnabled = !clampHoldsEnabled;
            setClampHoldsEnabled(clampHoldsEnabled);
            saveClampIdenticalSetting(clampHoldsEnabled);
        }
    });

    ui.addMenuItem({
        name: "Check for updates automatically" + (updateCheckEnabled ? " ✓" : ""),
        onMouseRelease: function() {
            updateCheckEnabled = !updateCheckEnabled;
            saveUpdateCheckSetting(updateCheckEnabled);
        }
    });

    ui.addMenuItem(separatorItem);

    ui.addMenuItem({
        name: "Clamp motion paths between holds",
        onMouseRelease: function() {
            fixHoldPaths();
        }
    });

    ui.addMenuItem(separatorItem);

    ui.addMenuItem({
        // Build ID identifies which bundle is actually loaded. currentVersion
        // itself stays clean so the update check keeps comparing versions.
        name: "Easey Version " + currentVersion + " (build " + BUILD_ID + ")",
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

// Containers signal clicks through onMousePress, not onClick.
applyButton.onMousePress = function() {
    applyEasingToKeyframes(currentEasing);
    saveTabPreference();
};

getButton.onMousePress = function() {
    if (getEasingFromKeyframes(currentEasing)) {
        updateTextInput();
        redrawGraphs();
    }
    saveTabPreference();
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

// Load clamp holds setting
clampHoldsEnabled = loadClampIdenticalSetting();
setClampHoldsEnabled(clampHoldsEnabled);

// Populate preset dropdown
populatePresetDropdown(presetList, presets);

// ============================================================================
// UI LAYOUT
// ============================================================================

// Create main layout
var mainLayout = new ui.VLayout();
mainLayout.setSpaceBetween(0);
mainLayout.setMargins(3, 3, 3, 3);

// Preset row. The dropdown goes away in favour of the Presets page; until then
// it keeps its own row, with the gear moved up into the bottom bar row.
var presetRow = new ui.HLayout();
presetRow.add(presetList);
presetRow.setMargins(0, 4, 0, 0);

// VALUE PAGE
var valueTabLayout = new ui.VLayout();
valueTabLayout.setSpaceBetween(0);
valueTabLayout.setMargins(0, 0, 0, 0);
valueTabLayout.add(graphCanvas);
valueTabLayout.addStretch();

// SPEED PAGE
var speedTabLayout = new ui.VLayout();
speedTabLayout.setSpaceBetween(0);
speedTabLayout.setMargins(0, 0, 0, 0);
speedTabLayout.add(speedGraphCanvas);
speedTabLayout.addStretch();

// PageView rather than TabView: TabView's chrome cannot be styled at all, so
// the tab strip above is built by hand and drives the pages directly.
var pageView = new ui.PageView();
pageView.add(valueTabLayout);
pageView.add(speedTabLayout);

var tabStrip = buildTabStrip([
    { label: "Value", icon: "value" },
    { label: "Speed", icon: "speed" }
], function(index) {
    pageView.setPage(index);
    redrawGraphs();
    saveTabPreference();
});

// Add to main layout
mainLayout.add(tabStrip.widget);
mainLayout.add(pageView);

// Bottom bar: get, field and apply share one rounded surface, gear sits outside
var buttonRow = new ui.HLayout();
buttonRow.add(buildBottomBar(bezierInput, getButton, applyButton));
buttonRow.add(presetContextButton);
buttonRow.setSpaceBetween(7);
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

// PageView has no onPageChanged callback; the tab strip's onSelect above is
// the only way pages change, and it already redraws and saves.

// Window size
ui.setMinimumWidth(graphWidth);
ui.setMinimumHeight(graphHeight + 60);

// Resize handler
ui.onResize = function() {
    var newWidth = ui.size().width;
    var newHeight = ui.size().height;
    
    // Tab strip (29) + bottom bar row (33) + preset row + window margins. Must
    // over- rather than under-estimate: too small and the window grows a
    // scrollbar, which overlaps the controls.
    var controlsHeight = 115;
    var margin = 6;

    // Below this the labels no longer fit beside the icons.
    tabStrip.setCompact(newWidth < TAB_LABEL_MIN_WIDTH);
    
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

// Restore last selected tab. Clamped because the tab count changes between
// versions, so a stored index can outrun the pages that exist.
isInitializingTab = true;
var savedTab = loadLastSelectedTab();
if (savedTab !== null) {
    var restoredTab = Math.max(0, Math.min(pageView.pageCount() - 1, savedTab));
    pageView.setPage(restoredTab);
    tabStrip.setSelected(restoredTab);
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
