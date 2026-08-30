// Default easing presets
export var DEFAULT_PRESETS = {
    "cubic-in": { x1: 0.55, y1: 0.055, x2: 0.675, y2: 0.19 },
    "cubic-out": { x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 },
    "cubic-in-out": { x1: 0.645, y1: 0.045, x2: 0.355, y2: 1 },
    "quart-in": { x1: 0.895, y1: 0.03, x2: 0.685, y2: 0.22 },
    "quart-out": { x1: 0.165, y1: 0.84, x2: 0.44, y2: 1 },
    "quart-in-out": { x1: 0.77, y1: 0, x2: 0.175, y2: 1 },
    "quint-in": { x1: 0.755, y1: 0.05, x2: 0.855, y2: 0.06 },
    "quint-out": { x1: 0.23, y1: 1, x2: 0.32, y2: 1 },
    "quint-in-out": { x1: 0.86, y1: 0, x2: 0.07, y2: 1 },
    "expo-in": { x1: 0.95, y1: 0.05, x2: 0.795, y2: 0.035 }
};

// Default easing values
export var DEFAULT_EASING = {
    x1: 0.5,
    y1: 0.0,
    x2: 0.0,
    y2: 1.0
};

// Graph dimensions. padding is the inset between the canvas edge and the plot,
// so lowering it grows the plot without changing the window layout. It has to
// stay clear of the 20px handle overshoot clamp plus the handle and its shadow.
export var GRAPH_CONFIG = {
    width: 230,
    height: 230,
    padding: 30,
    handleRadius: 6
};

// Speed graph defaults
export var DEFAULT_SPEED_EASING = {
    outInfluence: 33,  // Default 33% X influence
    inInfluence: 33,   // Default 33% X influence
    outSpeedY: 0,      // Left handle height (0 = baseline, 1 = the curve's peak speed)
    inSpeedY: 0,       // Right handle height (0 = baseline, 1 = the curve's peak speed)
    dragScale: 0       // Peak frozen for the duration of a drag; 0 = not dragging
};
