# Easey 
Makes easing easy.

# Long description
Easey is an advanced cubic bezier easing editor that brings the speed graph back to Cavalry.

Creates custom easing curves and apply them across keyframes. Even supports Cavalry's new motion paths!

Made by your friends in the Canva Creative Team.

## Features
- Interactive cubic Bezier curve editor with visual handles
- Speed and value graph
- Shift+drag for axis constraint
- Multi-attribute support
- Save and export presets
- Preserve motion paths and stop accidental overshoot between static keyframes

## Installation
1. Save Easey.js in your Cavalry scripts folder
2. Open via Scripts > Easey in Cavalry

## Usage
1. Select keyframes or use graph to adjust easing
2. Shift+drag to constrain handles
3. Use presets dropdown or type values (optional)
4. Apply easing with Apply button or auto apply under settings

## Additional features
- Copy keyframe values, speed and duration for developers under the context menu
- Import and export presets

## Changelog

[1.4.1] - 2026-04-02
Fixed
- Clamp function now preserves easing

[1.4.0] - 2026-03-20
Added
- Motion paths: automatically remove overshoot between keyframes of the same value

[1.3.0] - 2026-03-20
Added
- Support for motion paths

[1.2.0] - 2026-02-01
Added
- Incoming/outgoing speed support for Speed Graph
- Remember last selected tab when reopening
- Calculate average easing from all selected keyframes
- Single keyframe support
- Embedded icons - no easey_assets folder needed
Changed
- Hold CMD to mirror handles on the Speed Graph

[1.0.0] - 2025-11-05
- Initial release
