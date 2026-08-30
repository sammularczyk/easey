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
import { DEFAULT_EASING, GRAPH_CONFIG, DEFAULT_SPEED_EASING } from './modules/constants.js';
import { checkForUpdate } from './modules/updateChecker.js';
import { getCompositionFrameRate } from './modules/conversions.js';
import { drawCurve, drawSpeedCurve } from './modules/graphRenderer.js';
import { setupValueGraphHandlers, setupSpeedGraphHandlers } from './modules/mouseHandlers.js';
import { getEasingFromKeyframes, applyEasingToKeyframes, fixHoldPaths, setClampHoldsEnabled, copyKeyframeDuration, copyKeyframeValues, copyAllKeyframeInfo, readNeighbourSegments } from './modules/keyframeOps.js';
import {
    loadLibraries, saveLibraries, createLibrary, renameLibrary, deleteLibrary,
    exportLibrary, importLibrary, savePresetToLibrary, renameLibraryPreset,
    deleteLibraryPreset, movePresetToLibrary, movePreset,
    saveApplyOnDragSetting, loadApplyOnDragSetting,
    saveClampIdenticalSetting, loadClampIdenticalSetting,
    saveUpdateCheckSetting, loadUpdateCheckSetting,
    saveLastSelectedTab, loadLastSelectedTab,
    savePresetLayoutSetting, loadPresetLayoutSetting,
    saveDismissedUpdate, loadDismissedUpdate,
    copyCubicBezierToClipboard
} from './modules/presetManager.js';
import { initializeAssets, getAssetPath } from './modules/embeddedAssets.js';
import { BUILD_ID } from './modules/buildInfo.js';
import { buildTabStrip, buildIconButton, buildBottomBar } from './modules/chrome.js';
import { getTokens } from './modules/theme.js';
import { createPresetsPage } from './modules/presetsPage.js';

// Initialize embedded assets (writes icons to temp folder if needed)
initializeAssets();

// Set the window title
ui.setTitle("Easey");

// Version info
var GITHUB_REPO = "sammularczyk/Easey";
var scriptName = "Easey";
var currentVersion = "2.0.0";
var DOWNLOAD_URL = "https://github.com/sammularczyk/Easey/releases/latest/download/Easey.jsc";

// Set when a newer version exists, which overlays a banner on the graphs.
var updateAvailable = false;
var latestVersion = null;

// ============================================================================
// STATE
// ============================================================================

// Preset libraries, loaded (and migrated from the flat v1 store) on startup
var presetModel = { libraries: [] };
var selection = { libraryIndex: -1, presetIndex: -1 };

// Current easing values
var currentEasing = Object.assign({}, DEFAULT_EASING);

// Speed graph state
var speedEasing = Object.assign({}, DEFAULT_SPEED_EASING);

// The segments either side of the selected one, drawn as dim read-only ghosts so you can
// see what the curve you are building connects to. Read on Get and held until the next one —
// editing the interior handles cannot change what the neighbours do, so they should not
// move while you drag. null hides them.
var neighbourSegments = null;

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
// Which ghost curve the pointer is over, 'prev' / 'next' / null. Clicking it rotates the
// adjoining handle onto that neighbour's tangent.
var hoveredGhost = null;
var speedHoveredHandle = null;

// Update banner hover: the row reveals the dismiss X, download highlights
var bannerRowHover = false;
var bannerDownloadHover = false;

// Window width below which the tab strip drops its labels and shows icons only
var TAB_LABEL_MIN_WIDTH = 240;

// Index of the Presets tab, hidden while the split layout shows the panel
var PRESETS_TAB = 2;

// The graph's share of the usable height once the layout has split; the panel
// takes the rest. Unsplit, the graph takes all of it.
var GRAPH_SHARE_SPLIT = 0.5;

// Our own chrome inside ui.size(): tab strip (31) + bottom bar (33) + margins,
// plus a few px of slack. Filling the height exactly leaves no room for
// rounding, and the overflow becomes a scroll bar on the whole window.
var OWN_CHROME_HEIGHT = 78;

// Window height at which the presets panel replaces the Presets tab.
var SPLIT_MIN_HEIGHT = 450;

// Floor for the panel's height once the layout has split.
var MIN_PANEL_HEIGHT = 90;

// Whether the presets panel is currently shown beneath the controls
var isSplitLayout = false;

// Settings
var updateCheckEnabled = loadUpdateCheckSetting();
var presetLayout = "list";
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
// Lets the bottom bar compress. Left at its natural minimum the field keeps the
// bar wider than a narrow window, and the apply button is pushed off the edge.
bezierInput.setMinimumWidth(50);

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
    get hoveredGhost() { return hoveredGhost; },
    set hoveredGhost(v) { hoveredGhost = v; },
    get speedHoveredHandle() { return speedHoveredHandle; },
    set speedHoveredHandle(v) { speedHoveredHandle = v; },
    get bannerRowHover() { return bannerRowHover; },
    set bannerRowHover(v) { bannerRowHover = v; },
    get bannerDownloadHover() { return bannerDownloadHover; },
    set bannerDownloadHover(v) { bannerDownloadHover = v; }
};

// The banner is only drawn on the graphs, never on the presets page.
function isUpdateBannerVisible() {
    if (!updateAvailable) return false;

    // Dismissal is remembered per version, so a later release shows the banner
    // again rather than staying hidden forever.
    return loadDismissedUpdate() !== latestVersion;
}

function openDownloadPage() {
    api.openURL(DOWNLOAD_URL);
}

function dismissUpdateBanner() {
    if (latestVersion) {
        saveDismissedUpdate(latestVersion);
    }

    bannerRowHover = false;
    bannerDownloadHover = false;
    redrawGraphs();
}

// Get current graph config
function getGraphConfig() {
    return {
        width: graphWidth,
        height: graphHeight,
        padding: graphPadding,
        handleRadius: handleRadius,
        hoveredHandle: hoveredHandle,
        hoveredGhost: hoveredGhost,
        neighbours: neighbourSegments,
        updateAvailable: isUpdateBannerVisible(),
        bannerRowHover: bannerRowHover,
        bannerDownloadHover: bannerDownloadHover
    };
}

function getSpeedGraphConfig() {
    return {
        width: speedGraphWidth,
        height: speedGraphHeight,
        padding: speedGraphPadding,
        handleRadius: speedHandleRadius,
        hoveredHandle: speedHoveredHandle,
        hoveredGhost: hoveredGhost,
        neighbours: neighbourSegments,
        updateAvailable: isUpdateBannerVisible(),
        bannerRowHover: bannerRowHover,
        bannerDownloadHover: bannerDownloadHover
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
        clearPresetSelection();
        if (applyOnDragEnabled) {
            applyEasingToKeyframes(currentEasing);
        }
        saveTabPreference();
    },
    onHoverChange: function() {
        // Only the hovered canvas needs repainting, and hover must not touch
        // the text input or trigger apply-on-drag the way onUpdate does.
        drawCurve(graphCanvas, currentEasing, getGraphConfig());
    },
    onUpdateBannerClick: openDownloadPage,
    onUpdateBannerDismiss: dismissUpdateBanner
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
        clearPresetSelection();
        saveTabPreference();
    },
    onHoverChange: function() {
        drawSpeedCurve(speedGraphCanvas, currentEasing, speedEasing, getSpeedGraphConfig());
    },
    onUpdateBannerClick: openDownloadPage,
    onUpdateBannerDismiss: dismissUpdateBanner
});

// ============================================================================
// CONTEXT MENUS
// ============================================================================

// Editing the curve by hand means it no longer matches the selected preset.
function clearPresetSelection() {
    if (selection.libraryIndex === -1 && selection.presetIndex === -1) return;

    selection.libraryIndex = -1;
    selection.presetIndex = -1;
    refreshPresets();
}

function refreshPresets() {
    presetsPage.refresh();
    presetsPanel.refresh();
}

// Persist the model and rebuild the presets page. Every mutation goes through
// here: the page recreates its widgets from the model, so nothing may be cached
// across a change.
function commitPresetChange() {
    saveLibraries(presetModel);
    refreshPresets();
}

function loadPresetIntoEditor(preset) {
    currentEasing.x1 = preset.x1;
    currentEasing.y1 = preset.y1;
    currentEasing.x2 = preset.x2;
    currentEasing.y2 = preset.y2;

    updateTextInput();
    redrawGraphs();
}

// Cavalry menus have no submenus, so choosing a library means replacing the
// open menu with a second one listing them. With a single library there is
// nothing to choose and the action runs directly.
function chooseLibrary(title, onChosen, excludeIndex) {
    var choices = [];

    for (var i = 0; i < presetModel.libraries.length; i++) {
        if (i !== excludeIndex) choices.push(i);
    }

    if (choices.length === 0) return;

    if (choices.length === 1) {
        onChosen(choices[0]);
        return;
    }

    ui.clearContextMenu();
    ui.addMenuItem({ name: title, enabled: false });
    ui.addMenuItem({ name: "" });

    choices.forEach(function(libraryIndex) {
        ui.addMenuItem({
            name: presetModel.libraries[libraryIndex].name,
            onMouseRelease: function() {
                onChosen(libraryIndex);
            }
        });
    });

    ui.showContextMenu();
}

// Menu shown by a preset row's "..." button
function showPresetRowMenu(libraryIndex, presetIndex) {
    var preset = presetModel.libraries[libraryIndex].presets[presetIndex];

    ui.clearContextMenu();

    ui.addMenuItem({
        name: "Rename...",
        onMouseRelease: function() {
            if (renameLibraryPreset(presetModel, libraryIndex, presetIndex)) {
                commitPresetChange();
            }
        }
    });

    ui.addMenuItem({
        name: "Copy",
        onMouseRelease: function() {
            copyCubicBezierToClipboard(preset);
        }
    });

    function moveTo(targetIndex) {
        if (movePresetToLibrary(presetModel, libraryIndex, presetIndex, targetIndex)) {
            clearPresetSelection();
            commitPresetChange();
        }
    }

    var otherLibraries = [];
    for (var i = 0; i < presetModel.libraries.length; i++) {
        if (i !== libraryIndex) otherLibraries.push(i);
    }

    if (otherLibraries.length === 1) {
        // With one destination there is nothing to choose, so name it outright
        // rather than implying a further step with an ellipsis.
        var onlyTarget = otherLibraries[0];
        ui.addMenuItem({
            name: "Move to " + presetModel.libraries[onlyTarget].name,
            onMouseRelease: function() {
                moveTo(onlyTarget);
            }
        });
    } else if (otherLibraries.length > 1) {
        ui.addMenuItem({
            name: "Move to...",
            onMouseRelease: function() {
                chooseLibrary("Move to library", moveTo, libraryIndex);
            }
        });
    }

    ui.addMenuItem({ name: "" });

    ui.addMenuItem({
        name: "Delete",
        onMouseRelease: function() {
            if (deleteLibraryPreset(presetModel, libraryIndex, presetIndex)) {
                if (selection.libraryIndex === libraryIndex && selection.presetIndex === presetIndex) {
                    selection.libraryIndex = -1;
                    selection.presetIndex = -1;
                }
                commitPresetChange();
            }
        }
    });

    ui.showContextMenu();
}

// Menu shown by a library header's "..." button
function showLibraryMenu(libraryIndex) {
    ui.clearContextMenu();

    ui.addMenuItem({
        name: "Save Current Curve Here...",
        onMouseRelease: function() {
            if (savePresetToLibrary(presetModel, libraryIndex, currentEasing)) {
                commitPresetChange();
            }
        }
    });

    ui.addMenuItem({ name: "" });

    ui.addMenuItem({
        name: "Rename...",
        onMouseRelease: function() {
            if (renameLibrary(presetModel, libraryIndex)) {
                commitPresetChange();
            }
        }
    });

    ui.addMenuItem({
        name: "Export Library...",
        onMouseRelease: function() {
            exportLibrary(presetModel, libraryIndex);
        }
    });

    ui.addMenuItem({
        name: "Delete",
        onMouseRelease: function() {
            if (deleteLibrary(presetModel, libraryIndex)) {
                selection.libraryIndex = -1;
                selection.presetIndex = -1;
                commitPresetChange();
            }
        }
    });

    ui.showContextMenu();
}

function showPresetContextMenu() {
    ui.clearContextMenu();

    var separatorItem = { name: "" };

    ui.addMenuItem({
        name: "Save Preset...",
        onMouseRelease: function() {
            chooseLibrary("Save to library", function(libraryIndex) {
                if (savePresetToLibrary(presetModel, libraryIndex, currentEasing)) {
                    commitPresetChange();
                }
            });
        }
    });

    ui.addMenuItem({
        name: "New Library...",
        onMouseRelease: function() {
            if (createLibrary(presetModel)) {
                commitPresetChange();
            }
        }
    });

    ui.addMenuItem({
        name: "Import Library...",
        onMouseRelease: function() {
            if (importLibrary(presetModel)) {
                commitPresetChange();
            }
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

    ui.addMenuItem({ name: "Preset layout", enabled: false });

    ["list", "grid"].forEach(function(layout) {
        ui.addMenuItem({
            name: "    " + (layout === "list" ? "List" : "Grid") +
                  (presetLayout === layout ? " ✓" : ""),
            onMouseRelease: function() {
                if (presetLayout === layout) return;

                presetLayout = layout;
                savePresetLayoutSetting(layout);
                refreshPresets();
            }
        });
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
        // Read after the easing, so a selection Easey can read but cannot resolve to a
        // single segment still updates the curve and simply shows no ghosts.
        neighbourSegments = readNeighbourSegments();
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
        clearPresetSelection();
    }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

// Load preset libraries, migrating the flat v1 store on first run
presetModel = loadLibraries();

// Check for updates (unless the user turned it off)
if (updateCheckEnabled) {
    checkForUpdate(GITHUB_REPO, scriptName, currentVersion, function(available, newVersion) {
        updateAvailable = available;
        latestVersion = newVersion || null;
        if (available) redrawGraphs();
    });
}

// Load presets page layout
presetLayout = loadPresetLayoutSetting();

// Load apply on drag setting
applyOnDragEnabled = loadApplyOnDragSetting();

// Load clamp holds setting
clampHoldsEnabled = loadClampIdenticalSetting();
setClampHoldsEnabled(clampHoldsEnabled);

// ============================================================================
// UI LAYOUT
// ============================================================================

// Create main layout
var mainLayout = new ui.VLayout();
mainLayout.setSpaceBetween(0);
mainLayout.setMargins(3, 3, 3, 3);

// VALUE PAGE
var valueTabLayout = new ui.VLayout();
valueTabLayout.setSpaceBetween(0);
valueTabLayout.setMargins(0, 0, 0, 0);
// A VLayout will not centre a fixed-width child, so the square canvas needs
// stretches on both axes.
var graphCanvasRow = new ui.HLayout();
graphCanvasRow.setMargins(0, 0, 0, 0);
graphCanvasRow.addStretch();
graphCanvasRow.add(graphCanvas);
graphCanvasRow.addStretch();

// No vertical stretch: it would make this page expandable, and the PageView
// would then claim all the spare height and float the graph in the middle of
// it. The horizontal stretches inside the row still centre the square.
valueTabLayout.add(graphCanvasRow);

// SPEED PAGE
var speedTabLayout = new ui.VLayout();
speedTabLayout.setSpaceBetween(0);
speedTabLayout.setMargins(0, 0, 0, 0);
// A VLayout will not centre a fixed-width child, so the square canvas needs
// stretches on both axes.
var speedGraphCanvasRow = new ui.HLayout();
speedGraphCanvasRow.setMargins(0, 0, 0, 0);
speedGraphCanvasRow.addStretch();
speedGraphCanvasRow.add(speedGraphCanvas);
speedGraphCanvasRow.addStretch();

// No vertical stretch: it would make this page expandable, and the PageView
// would then claim all the spare height and float the graph in the middle of
// it. The horizontal stretches inside the row still centre the square.
speedTabLayout.add(speedGraphCanvasRow);

// PRESETS
// Two instances of the same list: one inside the tab page, one in the bottom
// panel used by the split layout. Cavalry cannot reparent a widget — clearing a
// layout destroys its children — so the list cannot move between the two as the
// window resizes. Both read the same model and are refreshed together.
var presetsConfig = {
    getModel: function() {
        return presetModel;
    },
    getSelection: function() {
        return selection;
    },
    onSelect: function(libraryIndex, presetIndex, preset) {
        selection.libraryIndex = libraryIndex;
        selection.presetIndex = presetIndex;

        // Guards the text field's onValueChanged from clearing the selection
        // we just made.
        isUpdatingFromPreset = true;
        loadPresetIntoEditor(preset);
        isUpdatingFromPreset = false;

        refreshPresets();

        // Apply straight away. This logs and no-ops when no keyframes are
        // selected, so it is safe on every click.
        applyEasingToKeyframes(currentEasing);
        saveTabPreference();
    },
    getLayout: function() {
        return presetLayout;
    },
    onLibraryMenu: showLibraryMenu,
    onPresetMenu: showPresetRowMenu,
    // Drag-to-reorder. Fires from whichever page instance (tab or split-view
    // panel) the drag started in — both share this config and this model, so
    // the callback works regardless of which one called it.
    onReorder: function(fromLibraryIndex, fromIndex, toLibraryIndex, toIndex) {
        if (movePreset(presetModel, fromLibraryIndex, fromIndex, toLibraryIndex, toIndex)) {
            // Indices shift under a move, so the old selection would point at
            // the wrong preset — same reasoning as the "move to library" menu
            // action above.
            clearPresetSelection();
            commitPresetChange();
        }
    }
};

var presetsPage = createPresetsPage(presetsConfig);
var presetsPanel = createPresetsPage(presetsConfig);

// PageView rather than TabView: TabView's chrome cannot be styled at all, so
// the tab strip above is built by hand and drives the pages directly.
var pageView = new ui.PageView();
pageView.add(valueTabLayout);
pageView.add(speedTabLayout);
pageView.add(presetsPage.widget);

var tabStrip = buildTabStrip([
    { label: "Value", icon: "value" },
    { label: "Speed", icon: "speed" },
    { label: "Presets", icon: "presets" }
], function(index) {
    pageView.setPage(index);
    redrawGraphs();
    saveTabPreference();
});

// Add to main layout. The PageView is a layout, not a widget: it has none of
// the common functions, and hosting it in a Container stops it rendering. Its
// height therefore cannot be set — it is governed by what its pages need.
mainLayout.add(tabStrip.widget);
mainLayout.add(pageView);

// Bottom bar: get, field and apply share one rounded surface, gear sits outside
var buttonRow = new ui.HLayout();
buttonRow.add(buildBottomBar(bezierInput, getButton, applyButton));
buttonRow.add(presetContextButton);
buttonRow.setSpaceBetween(7);
buttonRow.setMargins(0, 4, 0, 0);
mainLayout.add(buttonRow);

// Presets panel, shown only by the split layout. Hidden rather than omitted,
// because it cannot be added later without rebuilding the layout.
var panelHost = new ui.Container();
panelHost.setLayout(presetsPanel.widget);
panelHost.setHidden(true);
mainLayout.add(panelHost);

// Absorbs the leftover height in tabbed mode, where there is no panel to take
// it. Without this the layout hands the slack back to the PageView, which
// re-centres the graph and leaves a gap above it. Hidden widgets take no space,
// so exactly one of these two is ever active.
var tailSpacer = new ui.Container();
mainLayout.add(tailSpacer);

// Add to UI
ui.add(mainLayout);
ui.setBackgroundColor(ui.getThemeColor("Base"));

// Initialize display
updateTextInput();
redrawGraphs();
refreshPresets();

// PageView has no onPageChanged callback; the tab strip's onSelect above is
// the only way pages change, and it already redraws and saves.

// Window size. Deliberately small: the layout computes its own sizes on every
// resize, and a minimum derived from the initial GRAPH_CONFIG would fight it.
ui.setMinimumWidth(220);
ui.setMinimumHeight(260);

// Resize handler
ui.onResize = function() {
    var newWidth = ui.size().width;
    var newHeight = ui.size().height;

    // Must comfortably exceed the main layout's own left+right margins, or the
    // canvas asks for more room than the content area has and the window
    // ratchets wider on every resize.
    var margin = 14;
    var availableWidth = Math.max(150, newWidth - margin);

    // ui.size() reports the area available to this layout: it already excludes
    // Cavalry's window title bar and script tab. The only chrome to subtract is
    // ours — the tab strip, the bottom bar and the window margins.
    var availableHeight = Math.max(150, newHeight - OWN_CHROME_HEIGHT);

    var split = newHeight >= SPLIT_MIN_HEIGHT;

    // Square, so the curve is never distorted by the window's aspect ratio. It
    // takes everything going spare unless the panel needs its share.
    var graphSpace = split ? Math.floor(availableHeight * GRAPH_SHARE_SPLIT) : availableHeight;
    var square = Math.max(150, Math.min(availableWidth, graphSpace));

    // Whatever the square leaves, so the two together exactly fill the height.
    var panelHeight = Math.max(MIN_PANEL_HEIGHT, availableHeight - square);

    // Below this the labels no longer fit beside the icons.
    tabStrip.setCompact(newWidth < TAB_LABEL_MIN_WIDTH);

    // Runs ahead of the early-out below, because a height change can flip the
    // layout mode without altering the square's size.
    if (split !== isSplitLayout) {
        isSplitLayout = split;
        panelHost.setHidden(!split);
        tabStrip.setTabVisible(PRESETS_TAB, !split);

        // The Presets tab is gone in split mode, so its page must not stay up.
        if (split && pageView.currentPage() === PRESETS_TAB) {
            pageView.setPage(0);
            tabStrip.setSelected(0);
        }
    }

    // The panel is given an explicit height: a ScrollView with no restriction
    // grows to its content and drags the whole window with it.
    if (split) {
        panelHost.setFixedHeight(panelHeight);
        // The scroll area needs the bound too, or it grows to its content and
        // pushes past the host.
        presetsPanel.setViewportHeight(panelHeight);
    }

    presetsPage.setAvailableWidth(availableWidth);
    presetsPanel.setAvailableWidth(availableWidth);
    // The tab-mode list shares the graph's slot, so it gets the same height.
    presetsPage.setViewportHeight(square);


    // Re-applying an unchanged size is what turns any sizing feedback into a
    // runaway loop, so bail out when nothing actually moved.
    if (square === graphWidth && square === graphHeight) return;

    graphWidth = square;
    graphHeight = square;
    speedGraphWidth = square;
    speedGraphHeight = square;

    graphCanvas.setSize(square, square);
    speedGraphCanvas.setSize(square, square);

    redrawGraphs();
};

// Keep the ghosts in step with the keyframe selection.
//
// Deliberately does NOT touch currentEasing: the curve on the graph is what you are
// building, and having it jump to whatever you just clicked would throw away in-progress
// work. Only the read-only context around it follows the selection. Hit Get to actually
// load the selected keyframes' easing.
function Callbacks() {
    this.onKeySelectionChanged = function () {
        var next = readNeighbourSegments();
        // Both null is the common case while clicking around; skip the repaint.
        if (next === null && neighbourSegments === null) return;
        neighbourSegments = next;
        redrawGraphs();
    };
}
ui.addCallbackObject(new Callbacks());

// Show window
ui.show();

// Restore last selected tab. Clamped because the tab count changes between
// versions, so a stored index can outrun the pages that exist.
isInitializingTab = true;
var savedTab = loadLastSelectedTab();
if (savedTab !== null) {
    var restoredTab = Math.max(0, Math.min(pageView.pageCount() - 1, savedTab));

    // The Presets tab is hidden while the split layout shows the panel, so
    // restoring onto it would leave a page with no way back to it.
    if (isSplitLayout && restoredTab === PRESETS_TAB) restoredTab = 0;

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
