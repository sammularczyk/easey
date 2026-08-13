# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with the exception that the `major` version is used for marketing purposes,
not to indicate breaking changes.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

-   `Added` for new features
-   `Changed` for changes in existing functionality
-   `Deprecated` for soon-to-be removed features
-   `Removed` for now removed features
-   `Fixed` for any bug fixes
-   `Security` in case of vulnerabilities


## [2.0.0] - 2026-08-13
### Added
- **Preset libraries.** Presets now live in named libraries with their own section headers, and can be renamed, moved between libraries, and deleted from a menu on each row. Existing presets are migrated automatically into a "My Presets" library.
- **Export and import libraries** as JSON files.
- **A Presets tab**, replacing the preset dropdown. Each row draws a live thumbnail of its own curve. Clicking a preset applies it to the selected keyframes.
- Handles grow on hover, and the tab strip collapses to icons when the window is too narrow for labels.

### Changed
- **Rebuilt UI**: a segmented tab strip, a single composite bottom bar, and green accented controls.
- Colours now follow the Cavalry theme rather than being hardcoded, so Easey no longer assumes a dark UI.
- Curve values drop trailing zeros — `0.5, 0, 0, 1` rather than `0.500, 0.000, 0.000, 1.000`.
- Preset rename and delete moved out of the settings menu and onto each preset's own menu; export and delete for a whole library moved onto the library's menu. Saving a preset now asks which library to put it in.

### Fixed
- The curve is no longer invisible on light Cavalry themes.
- Deleting a preset now asks for confirmation.

## [1.5.1] - 2026-08-07
### Fixed
- Applying easing to some of a layer's keyframes no longer affects surrounding keyframes.

## [1.5.0] - 2026-08-05
### Added
- **Straight motion path segments now use tangent easing**. Useful when a shape has to stay pinned to a corner of something that is scaling.
- The automatic update check can now be disabled.

## [1.4.0] - 2026-03-20
### Added
- **Motion paths: automatically remove overshoot between keyframes of the same value!** Just apply easing to multiple keyframes or go to Settings to fix any annoying overshoots.

## [1.3.0] - 2026-03-20
### Added
- **Support for motion paths!** Easey now performs correctly whether you have motion paths or not.

## [1.2.0] - 2026-02-01
### Added
- **Incoming/outgoing speed support for Speed Graph.** You can now drag the handles up!
- **Remember last selected tab** when reopening
- **Calculate average easing** from all selected keyframes
- **Single keyframe support**
- **Embedded icons** - no easey_assets folder needed.

### Changed
- Hold CMD to mirror handles on the Speed Graph 

## [1.0.0] - 2025-11-05

-   Initial release
