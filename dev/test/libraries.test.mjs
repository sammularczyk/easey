// Run with: node dev/test/libraries.test.mjs
// Covers the pure parts of the library model: migration from the flat v1 shape
// and defensive normalisation of whatever comes back out of preferences.
// The mutating ops aren't covered here — they all open a ui.Modal.

import assert from "node:assert/strict";
import { buildLibrariesFromFlat, normaliseLibraries } from "../src/modules/presetManager.js";

// --- migration from the flat v1 shape ---------------------------------------

const flat = {
    "Zed": { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
    "alpha": { x1: 0, y1: 0, x2: 1, y2: 1 }
};
const migrated = buildLibrariesFromFlat(flat, "My Presets");

assert.equal(migrated.libraries.length, 1, "flat map becomes one library");
assert.equal(migrated.libraries[0].name, "My Presets");
assert.deepEqual(
    migrated.libraries[0].presets.map(p => p.name),
    ["alpha", "Zed"],
    "sorted case-insensitively, so 'alpha' precedes 'Zed'"
);
assert.deepEqual(migrated.libraries[0].presets[1], { name: "Zed", x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 });

assert.equal(buildLibrariesFromFlat({}, "Empty").libraries[0].presets.length, 0);
assert.equal(buildLibrariesFromFlat(undefined, "Empty").libraries[0].presets.length, 0);

// --- normalising what comes back from preferences ---------------------------

assert.equal(normaliseLibraries(null), null);
assert.equal(normaliseLibraries({}), null, "no libraries array");
assert.equal(normaliseLibraries({ libraries: [] }), null, "empty is unusable");

const good = { libraries: [{ name: "L", presets: [{ name: "p", x1: 0, y1: 0, x2: 1, y2: 1 }] }] };
assert.deepEqual(normaliseLibraries(good), good, "valid model round-trips");

// A library with no presets is legitimate — you can create an empty one.
assert.deepEqual(
    normaliseLibraries({ libraries: [{ name: "L", presets: [] }] }),
    { libraries: [{ name: "L", presets: [] }] }
);
assert.deepEqual(
    normaliseLibraries({ libraries: [{ name: "L" }] }).libraries[0].presets,
    [],
    "missing presets array becomes empty rather than throwing"
);

// Malformed presets are dropped, not fatal — prefs are editable on disk.
const dirty = {
    libraries: [{
        name: "L",
        presets: [
            { name: "ok", x1: 0, y1: 0, x2: 1, y2: 1 },
            { name: "missing coords" },
            { x1: 0, y1: 0, x2: 1, y2: 1 },
            { name: "nan", x1: NaN, y1: 0, x2: 1, y2: 1 },
            { name: "string coord", x1: "0", y1: 0, x2: 1, y2: 1 },
            null
        ]
    }]
};
assert.deepEqual(
    normaliseLibraries(dirty).libraries[0].presets.map(p => p.name),
    ["ok"],
    "only the well-formed preset survives"
);

assert.equal(
    normaliseLibraries({ libraries: [{ presets: [] }, null] }),
    null,
    "libraries without a name are dropped, leaving nothing usable"
);

// Extra keys are stripped rather than carried through into storage.
const extra = { libraries: [{ name: "L", extra: 1, presets: [{ name: "p", x1: 0, y1: 0, x2: 1, y2: 1, junk: 2 }] }] };
assert.deepEqual(Object.keys(normaliseLibraries(extra).libraries[0]), ["name", "presets"]);
assert.deepEqual(Object.keys(normaliseLibraries(extra).libraries[0].presets[0]), ["name", "x1", "y1", "x2", "y2"]);

console.log("libraries: all assertions passed");
