// Keyframe operations module
// Functions for extracting and applying easing to keyframes

import { cubicBezierToCavalry, cavalryToCubicBezier, getCompositionFrameRate, framesToMilliseconds } from './conversions.js';

/**
 * Ensure keyframes are set to bezier interpolation and unlock tangents
 */
function ensureBezierInterpolation(keyframeId, attrId, layerId, frame) {
    try {
        var keyData = api.get(keyframeId, 'data');
        if (!keyData) {
            console.log("Could not get keyframe data for:", keyframeId);
            return false;
        }
        
        if (keyData.interpolation !== 0) {
            try {
                api.modifyKeyframe(keyframeId, 'interpolation', 0);
            } catch (e) {
                console.log("Could not set interpolation to bezier:", e.message);
            }
        }
        
        try {
            api.set(keyframeId, 'locked', false);
            api.set(keyframeId, 'weightLocked', false);
        } catch (e) {
            console.log("Failed to unlock keyframe tangents with api.set():", e.message);
        }
        
        return true;
    } catch (error) {
        console.log("Error ensuring bezier interpolation:", error.message);
        return false;
    }
}

/**
 * Apply easing to a single pair of keyframes
 */
function applyEasingToKeyframePair(currentKeyId, nextKeyId, currentKeyData, nextKeyData, cavalryHandles, attrId, layerId, currentFrame, currentValue, nextFrame, nextValue) {
    try {
        currentKeyData = api.get(currentKeyId, 'data');
        nextKeyData = api.get(nextKeyId, 'data');
        
        try {
            var unlocked = { angleLocked: false, weightLocked: false };
            
            if (currentKeyData) {
                var tangentObj1 = {};
                tangentObj1[attrId] = {
                    frame: currentFrame,
                    inHandle: false,
                    outHandle: true,
                    xValue: currentFrame + cavalryHandles.outHandleX,
                    yValue: currentValue + cavalryHandles.outHandleY,
                    ...unlocked
                };
                api.modifyKeyframeTangent(layerId, tangentObj1);
            }
            
            if (nextKeyData) {
                var tangentObj2 = {};
                tangentObj2[attrId] = {
                    frame: nextFrame,
                    inHandle: true,
                    outHandle: false,
                    xValue: nextFrame + cavalryHandles.inHandleX,
                    yValue: nextValue + cavalryHandles.inHandleY,
                    ...unlocked
                };
                api.modifyKeyframeTangent(layerId, tangentObj2);
            }
            
        } catch (e) {
            try {
                if (currentKeyData && currentKeyData.rightBez) {
                    api.modifyKeyframe(currentKeyId, 'rightBez.x', cavalryHandles.outHandleX);
                    api.modifyKeyframe(currentKeyId, 'rightBez.y', cavalryHandles.outHandleY);
                }
                
                if (nextKeyData && nextKeyData.leftBez) {
                    api.modifyKeyframe(nextKeyId, 'leftBez.x', cavalryHandles.inHandleX);
                    api.modifyKeyframe(nextKeyId, 'leftBez.y', cavalryHandles.inHandleY);
                }
            } catch (e2) {
                console.log("Error: Alternative approach also failed:", e2.message);
            }
        }
        
        return true;
    } catch (error) {
        console.log("Error applying easing to keyframe pair:", error.message);
        return false;
    }
}

/**
 * Unlock all keyframes in a group
 */
function unlockAllKeyframes(keyframeIds, attrId, layerId, selectedFrames) {
    var unlocked = { angleLocked: false, weightLocked: false };
    
    for (var i = 0; i < keyframeIds.length; i++) {
        var keyframeId = keyframeIds[i];
        var frame = selectedFrames[i];
        
        try {
            var keyData = api.get(keyframeId, 'data');
            
            if (keyData && keyData.interpolation !== 0) {
                api.modifyKeyframe(keyframeId, 'interpolation', 0);
                keyData = api.get(keyframeId, 'data');
            }
            
            if (keyData) {
                if (!keyData.leftBez) {
                    try {
                        api.modifyKeyframe(keyframeId, 'leftBez.x', 0);
                        api.modifyKeyframe(keyframeId, 'leftBez.y', 0);
                    } catch (e) {}
                }
                
                if (!keyData.rightBez) {
                    try {
                        api.modifyKeyframe(keyframeId, 'rightBez.x', 0);
                        api.modifyKeyframe(keyframeId, 'rightBez.y', 0);
                    } catch (e) {}
                }
            }
            
            try {
                var unlockObj = {};
                unlockObj[attrId] = {
                    frame: frame,
                    inHandle: true,
                    outHandle: true,
                    ...unlocked
                };
                api.modifyKeyframeTangent(layerId, unlockObj);
            } catch (e) {}
            
        } catch (e) {}
    }
}

/**
 * Apply easing to a single keyframe's both handles independently
 */
function applyEasingToSingleKeyframe(keyframeId, attrId, layerId, frame, value, currentEasing) {
    try {
        var defaultFrameDiff = 30;
        var defaultValueDiff = 100;
        
        var cavalryHandles = cubicBezierToCavalry(
            currentEasing.x1, currentEasing.y1, 
            currentEasing.x2, currentEasing.y2, 
            defaultFrameDiff, defaultValueDiff
        );
        
        var keyData = api.get(keyframeId, 'data');
        if (keyData && keyData.interpolation !== 0) {
            api.modifyKeyframe(keyframeId, 'interpolation', 0);
            keyData = api.get(keyframeId, 'data');
        }
        
        if (keyData) {
            if (!keyData.leftBez) {
                try {
                    api.modifyKeyframe(keyframeId, 'leftBez.x', 0);
                    api.modifyKeyframe(keyframeId, 'leftBez.y', 0);
                } catch (e) {}
            }
            if (!keyData.rightBez) {
                try {
                    api.modifyKeyframe(keyframeId, 'rightBez.x', 0);
                    api.modifyKeyframe(keyframeId, 'rightBez.y', 0);
                } catch (e) {}
            }
        }
        
        var unlocked = { angleLocked: false, weightLocked: false };
        
        var tangentObjOut = {};
        tangentObjOut[attrId] = {
            frame: frame,
            inHandle: false,
            outHandle: true,
            xValue: frame + cavalryHandles.outHandleX,
            yValue: value + cavalryHandles.outHandleY,
            ...unlocked
        };
        api.modifyKeyframeTangent(layerId, tangentObjOut);
        
        var tangentObjIn = {};
        tangentObjIn[attrId] = {
            frame: frame,
            inHandle: true,
            outHandle: false,
            xValue: frame + cavalryHandles.inHandleX,
            yValue: value + cavalryHandles.inHandleY,
            ...unlocked
        };
        api.modifyKeyframeTangent(layerId, tangentObjIn);
        
        return true;
    } catch (error) {
        console.log("Error applying easing to single keyframe:", error.message);
        return false;
    }
}

/**
 * Get easing from selected keyframes
 * @param {Object} currentEasing - Current easing state to update
 * @returns {boolean} Success status
 */
export function getEasingFromKeyframes(currentEasing) {
    try {
        var selectedKeyframes = api.getSelectedKeyframes();
        var keyframeIds = api.getSelectedKeyframeIds();
        
        if (keyframeIds.length < 1) {
            console.log("Error: Please select at least 1 keyframe");
            return false;
        }
        
        // If only 1 keyframe is selected, extract from its handles
        if (keyframeIds.length === 1) {
            var keyframeId = keyframeIds[0];
            var attrPath = api.getAttributeFromKeyframeId(keyframeId);
            
            var hashIndex = attrPath.indexOf('#');
            if (hashIndex === -1) {
                console.log("Error: Invalid layer ID format");
                return false;
            }
            
            var dotAfterHash = attrPath.indexOf('.', hashIndex);
            if (dotAfterHash === -1) {
                console.log("Error: Could not parse attribute");
                return false;
            }
            
            var layerId = attrPath.substring(0, dotAfterHash);
            var attrId = attrPath.substring(dotAfterHash + 1);
            
            var keyData = api.get(keyframeId, 'data');
            if (!keyData) {
                console.log("Error: Could not get keyframe data");
                return false;
            }
            
            if (!keyData.rightBez) {
                console.log("Single keyframe has no bezier handles - keeping current curve");
                return true;
            }
            
            var defaultFrameDiff = 30;
            var defaultValueDiff = 100;
            
            var outHandleX = keyData.rightBez.x;
            var outHandleY = keyData.rightBez.y;
            var inHandleX = -outHandleX;
            var inHandleY = -outHandleY;
            
            var bezier = cavalryToCubicBezier(outHandleX, outHandleY, inHandleX, inHandleY, defaultFrameDiff, defaultValueDiff);
            
            currentEasing.x1 = bezier.x1;
            currentEasing.y1 = bezier.y1;
            currentEasing.x2 = bezier.x2;
            currentEasing.y2 = bezier.y2;
            
            console.log("Extracted easing from single keyframe's handles");
            return true;
        }
        
        // Collect all attribute groups with 2+ keyframes
        var attributeGroups = {};
        
        for (let [fullAttributePath, frames] of Object.entries(selectedKeyframes)) {
            if (frames.length >= 2) {
                var hashIndex = fullAttributePath.indexOf('#');
                if (hashIndex === -1) continue;
                
                var dotAfterHash = fullAttributePath.indexOf('.', hashIndex);
                if (dotAfterHash === -1) continue;
                
                var layerId = fullAttributePath.substring(0, dotAfterHash);
                var attrId = fullAttributePath.substring(dotAfterHash + 1);
                
                var attributeKeyframeIds = [];
                for (var i = 0; i < keyframeIds.length; i++) {
                    var keyframeAttrPath = api.getAttributeFromKeyframeId(keyframeIds[i]);
                    if (keyframeAttrPath === fullAttributePath) {
                        attributeKeyframeIds.push(keyframeIds[i]);
                    }
                }
                
                if (attributeKeyframeIds.length >= 2) {
                    attributeGroups[fullAttributePath] = {
                        layerId: layerId,
                        attrId: attrId,
                        frames: frames.sort((a, b) => a - b),
                        keyframeIds: attributeKeyframeIds
                    };
                }
            }
        }
        
        if (Object.keys(attributeGroups).length === 0) {
            console.log("Error: No valid attribute groups found with 2+ keyframes");
            return false;
        }
        
        var totalX1 = 0, totalY1 = 0, totalX2 = 0, totalY2 = 0;
        var pairCount = 0;
        var currentFrame = api.getFrame();
        
        for (let [attributePath, group] of Object.entries(attributeGroups)) {
            for (var i = 0; i < group.keyframeIds.length - 1; i++) {
                var currentKeyId = group.keyframeIds[i];
                var nextKeyId = group.keyframeIds[i + 1];
                
                var firstFrame = group.frames[i];
                var secondFrame = group.frames[i + 1];
                var frameDiff = secondFrame - firstFrame;
                
                if (frameDiff <= 0) continue;
                
                api.setFrame(firstFrame);
                var firstValue = api.get(group.layerId, group.attrId);
                api.setFrame(secondFrame);
                var secondValue = api.get(group.layerId, group.attrId);
                
                var valueDiff = secondValue - firstValue;
                
                var firstKeyData = api.get(currentKeyId, 'data');
                var secondKeyData = api.get(nextKeyId, 'data');
                
                var frameZeroData, frameEndData;
                if (Math.abs(firstKeyData.numValue - firstValue) < 0.1) {
                    frameZeroData = firstKeyData;
                    frameEndData = secondKeyData;
                } else {
                    frameZeroData = secondKeyData;
                    frameEndData = firstKeyData;
                }
                
                var outHandleX = null, outHandleY = null;
                var inHandleX = null, inHandleY = null;
                
                if (frameZeroData && frameZeroData.rightBez) {
                    outHandleX = frameZeroData.rightBez.x;
                    outHandleY = frameZeroData.rightBez.y;
                }
                
                if (frameEndData && frameEndData.leftBez) {
                    inHandleX = frameEndData.leftBez.x;
                    inHandleY = frameEndData.leftBez.y;
                }
                
                if (outHandleX !== null && inHandleX !== null) {
                    var bezier = cavalryToCubicBezier(outHandleX, outHandleY, inHandleX, inHandleY, frameDiff, valueDiff);
                    totalX1 += bezier.x1;
                    totalY1 += bezier.y1;
                    totalX2 += bezier.x2;
                    totalY2 += bezier.y2;
                    pairCount++;
                } else {
                    totalX1 += 0;
                    totalY1 += 0;
                    totalX2 += 1;
                    totalY2 += 1;
                    pairCount++;
                }
            }
        }
        
        api.setFrame(currentFrame);
        
        if (pairCount === 0) {
            console.log("Error: Could not extract easing data from any keyframe pairs");
            return false;
        }
        
        currentEasing.x1 = totalX1 / pairCount;
        currentEasing.y1 = totalY1 / pairCount;
        currentEasing.x2 = totalX2 / pairCount;
        currentEasing.y2 = totalY2 / pairCount;
        
        if (pairCount > 1) {
            console.log("Averaged easing from " + pairCount + " keyframe pairs");
        }
        
        return true;
        
    } catch (error) {
        console.log("Error: " + error.message);
        return false;
    }
}

/**
 * Apply easing to selected keyframes
 * @param {Object} currentEasing - Current easing values to apply
 * @returns {boolean} Success status
 */
export function applyEasingToKeyframes(currentEasing) {
    try {
        var selectedKeyframes = api.getSelectedKeyframes();
        var keyframeIds = api.getSelectedKeyframeIds();
        
        if (keyframeIds.length < 1) {
            console.log("Error: Please select at least 1 keyframe");
            return false;
        }
        
        // Single keyframe case
        if (keyframeIds.length === 1) {
            var keyframeId = keyframeIds[0];
            var attrPath = api.getAttributeFromKeyframeId(keyframeId);
            
            var hashIndex = attrPath.indexOf('#');
            if (hashIndex === -1) {
                console.log("Error: Invalid layer ID format");
                return false;
            }
            
            var dotAfterHash = attrPath.indexOf('.', hashIndex);
            if (dotAfterHash === -1) {
                console.log("Error: Could not parse attribute");
                return false;
            }
            
            var layerId = attrPath.substring(0, dotAfterHash);
            var attrId = attrPath.substring(dotAfterHash + 1);
            
            var keyframeFrame = null;
            for (let [path, frames] of Object.entries(selectedKeyframes)) {
                if (path === attrPath && frames.length === 1) {
                    keyframeFrame = frames[0];
                    break;
                }
            }
            
            if (keyframeFrame === null) {
                console.log("Error: Could not determine keyframe frame number");
                return false;
            }
            
            var currentFrame = api.getFrame();
            api.setFrame(keyframeFrame);
            var value = api.get(layerId, attrId);
            
            var success = applyEasingToSingleKeyframe(keyframeId, attrId, layerId, keyframeFrame, value, currentEasing);
            
            api.setFrame(currentFrame);
            
            if (success) {
                console.log("Applied easing to single keyframe's incoming and outgoing handles");
            }
            
            return success;
        }
        
        // Group keyframes by attribute path
        var attributeGroups = {};
        
        for (let [fullAttributePath, frames] of Object.entries(selectedKeyframes)) {
            if (frames.length >= 2) {
                var hashIndex = fullAttributePath.indexOf('#');
                if (hashIndex === -1) continue;
                
                var dotAfterHash = fullAttributePath.indexOf('.', hashIndex);
                if (dotAfterHash === -1) continue;
                
                var layerId = fullAttributePath.substring(0, dotAfterHash);
                var attrId = fullAttributePath.substring(dotAfterHash + 1);
                
                var attributeKeyframeIds = [];
                
                for (var i = 0; i < keyframeIds.length; i++) {
                    var keyframeAttrPath = api.getAttributeFromKeyframeId(keyframeIds[i]);
                    
                    if (keyframeAttrPath === fullAttributePath) {
                        attributeKeyframeIds.push(keyframeIds[i]);
                    }
                }
                
                if (attributeKeyframeIds.length >= 2) {
                    attributeGroups[fullAttributePath] = {
                        layerId: layerId,
                        attrId: attrId,
                        frames: frames.sort((a, b) => a - b),
                        keyframeIds: attributeKeyframeIds
                    };
                }
            }
        }
        
        if (Object.keys(attributeGroups).length === 0) {
            console.log("Error: No valid attribute groups found with 2+ keyframes");
            return false;
        }
        
        var totalProcessed = 0;
        var currentFrameTime = api.getFrame();
        
        for (let [attributePath, group] of Object.entries(attributeGroups)) {
            try {
                unlockAllKeyframes(group.keyframeIds, group.attrId, group.layerId, group.frames);
                
                for (var i = 0; i < group.keyframeIds.length - 1; i++) {
                    var currentKeyId = group.keyframeIds[i];
                    var nextKeyId = group.keyframeIds[i + 1];
                    
                    var currentFrame = group.frames[i];
                    var nextFrame = group.frames[i + 1];
                    var frameDiff = nextFrame - currentFrame;
                    
                    api.setFrame(currentFrame);
                    var currentValue = api.get(group.layerId, group.attrId);
                    api.setFrame(nextFrame);
                    var nextValue = api.get(group.layerId, group.attrId);
                    
                    var valueDiff = nextValue - currentValue;
                    
                    var cavalryHandles = cubicBezierToCavalry(
                        currentEasing.x1, currentEasing.y1, 
                        currentEasing.x2, currentEasing.y2, 
                        frameDiff, valueDiff
                    );
                    
                    var currentKeyData = api.get(currentKeyId, 'data');
                    var nextKeyData = api.get(nextKeyId, 'data');
                    
                    applyEasingToKeyframePair(currentKeyId, nextKeyId, currentKeyData, nextKeyData, cavalryHandles, group.attrId, group.layerId, currentFrame, currentValue, nextFrame, nextValue);
                    
                    totalProcessed++;
                }
                
            } catch (groupError) {
                console.log("Error processing attribute " + attributePath + ":", groupError.message);
            }
        }
        
        api.setFrame(currentFrameTime);
        return true;
        
    } catch (error) {
        console.log("Error applying easing to keyframes:", error.message);
        return false;
    }
}

/**
 * Get keyframe data and extract bezier information for 2 selected keyframes
 * @returns {Object|null} Keyframe info object or null on error
 */
export function getKeyframeInfo() {
    var selectedKeyframes = api.getSelectedKeyframes();
    var keyframeIds = api.getSelectedKeyframeIds();
    
    if (keyframeIds.length !== 2) {
        console.error("Error: Please select exactly 2 keyframes");
        return null;
    }
    
    try {
        var attrPath = api.getAttributeFromKeyframeId(keyframeIds[0]);
        var attrPath2 = api.getAttributeFromKeyframeId(keyframeIds[1]);
        
        if (attrPath !== attrPath2) {
            console.error("Error: Both keyframes must be on the same attribute");
            return null;
        }
        
        var layerId, attrId, selectedFrames;
        var fullAttributePath = null;
        
        for (let [key, frames] of Object.entries(selectedKeyframes)) {
            if (frames.length === 2) {
                fullAttributePath = key;
                selectedFrames = frames.sort((a, b) => a - b);
                break;
            }
        }
        
        if (!fullAttributePath) {
            console.error("Error: Could not find attribute with 2 selected keyframes");
            return null;
        }
        
        var hashIndex = fullAttributePath.indexOf('#');
        if (hashIndex === -1) {
            console.error("Error: Invalid layer ID format in: " + fullAttributePath);
            return null;
        }
        
        var dotAfterHash = fullAttributePath.indexOf('.', hashIndex);
        if (dotAfterHash === -1) {
            console.error("Error: Could not parse attribute from: " + fullAttributePath);
            return null;
        }
        
        layerId = fullAttributePath.substring(0, dotAfterHash);
        attrId = fullAttributePath.substring(dotAfterHash + 1);
        
        if (selectedFrames.length !== 2) {
            console.error("Error: Could not find 2 selected frames");
            return null;
        }
        
        var firstFrame = selectedFrames[0];
        var secondFrame = selectedFrames[1];
        
        var currentFrame = api.getFrame();
        
        var firstValue, secondValue;
        try {
            api.setFrame(firstFrame);
            firstValue = api.get(layerId, attrId);
            
            api.setFrame(secondFrame);
            secondValue = api.get(layerId, attrId);
            
            api.setFrame(currentFrame);
        } catch (e) {
            api.setFrame(currentFrame);
            console.error("Error getting keyframe values: " + e.message);
            return null;
        }
        
        var easingValues = null;
        
        try {
            var firstKeyData = api.get(keyframeIds[0], 'data');
            var secondKeyData = api.get(keyframeIds[1], 'data');
            
            var kf1Data = api.get(keyframeIds[0], 'data');
            var kf2Data = api.get(keyframeIds[1], 'data');
            
            var frameZeroData, frameEndData;
            
            if (Math.abs(kf1Data.numValue - firstValue) < 0.1) {
                frameZeroData = kf1Data;
                frameEndData = kf2Data;
            } else {
                frameZeroData = kf2Data;
                frameEndData = kf1Data;
            }
            
            var outHandleX = null, outHandleY = null;
            var inHandleX = null, inHandleY = null;
            
            if (frameZeroData && frameZeroData.rightBez) {
                outHandleX = frameZeroData.rightBez.x;
                outHandleY = frameZeroData.rightBez.y;
            }
            
            if (frameEndData && frameEndData.leftBez) {
                inHandleX = frameEndData.leftBez.x;
                inHandleY = frameEndData.leftBez.y;
            }
            
            if (outHandleX !== null && inHandleX !== null) {
                var frameDiff = secondFrame - firstFrame;
                var valueDiff = secondValue - firstValue;
                
                if (frameDiff > 0) {
                    var x1 = outHandleX / frameDiff;
                    var y1 = 0;
                    if (Math.abs(valueDiff) > 0.001) {
                        y1 = outHandleY / valueDiff;
                    }
                    
                    var x2 = (frameDiff + inHandleX) / frameDiff;
                    var y2 = 1;
                    if (Math.abs(valueDiff) > 0.001) {
                        y2 = 1 + (inHandleY / valueDiff);
                    }
                    
                    x1 = Math.max(0, Math.min(1, x1));
                    x2 = Math.max(0, Math.min(1, x2));
                    
                    easingValues = x1.toFixed(3) + "," + y1.toFixed(3) + "," + x2.toFixed(3) + "," + y2.toFixed(3);
                }
            }
            
            if (!easingValues) {
                console.error("Could not extract bezier data from keyframes");
                return null;
            }
            
        } catch (e) {
            console.error("Error extracting bezier data:", e.message);
            return null;
        }
        
        var frameRate = getCompositionFrameRate();
        var frameDuration = secondFrame - firstFrame;
        var durationMs = framesToMilliseconds(frameDuration, frameRate);
        
        var propertyName = attrId;
        propertyName = propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
        propertyName = propertyName.replace(/([A-Z])/g, ' $1').trim();
        
        function formatValue(value) {
            if (typeof value === 'number') {
                return Math.round(value * 100) / 100;
            }
            return value;
        }
        
        var formattedStartValue = formatValue(firstValue);
        var formattedEndValue = formatValue(secondValue);
        
        return {
            easing: easingValues,
            duration: durationMs,
            frameDuration: frameDuration,
            propertyName: propertyName,
            startValue: formattedStartValue,
            endValue: formattedEndValue,
            layerId: layerId,
            attrId: attrId,
            firstFrame: firstFrame,
            secondFrame: secondFrame,
            frameRate: frameRate
        };
        
    } catch (error) {
        console.error("Overall error:", error.message);
        return null;
    }
}

/**
 * Copy keyframe duration to clipboard
 */
export function copyKeyframeDuration() {
    try {
        var info = getKeyframeInfo();
        if (info) {
            var durationText = info.propertyName + ": " + info.duration + "ms (" + info.frameDuration + " frames @ " + getCompositionFrameRate() + "fps)";
            api.setClipboardText(durationText);
            console.log("Copied duration: " + durationText);
        }
    } catch (e) {
        console.error("Duration copy error:", e.message);
    }
}

/**
 * Copy keyframe values to clipboard
 */
export function copyKeyframeValues() {
    try {
        var info = getKeyframeInfo();
        if (info) {
            var valuesText = info.propertyName + " " + info.startValue + " > " + info.endValue;
            api.setClipboardText(valuesText);
            console.log("Copied values: " + valuesText);
        }
    } catch (e) {
        console.error("Values copy error:", e.message);
    }
}

/**
 * Copy all keyframe info to clipboard
 */
export function copyAllKeyframeInfo() {
    try {
        var info = getKeyframeInfo();
        if (info) {
            var allText = info.propertyName + "\n" + info.startValue + " > " + info.endValue + "\n" + "cubic-bezier(" + info.easing + ")" + "\n" +
                         "Duration: " + info.duration + "ms" + "\n";
            api.setClipboardText(allText);
            console.log("Copied all keyframe info to clipboard");
        }
    } catch (e) {
        console.error("All info copy error:", e.message);
    }
}
