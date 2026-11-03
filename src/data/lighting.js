// Mode ids extracted from the official AULA web configurator; names cleaned up from its machine translation.
// `color` = the mode accepts a fixed colour (otherwise it is always multicolour).

export const MAIN_MODES = [
  { mode: 0, name: "Off", color: false },
  { mode: 1, name: "Static", color: true },
  { mode: 2, name: "Breathing", color: true },
  { mode: 3, name: "Neon", color: false },
  { mode: 4, name: "Burst", color: true },
  { mode: 5, name: "Rain", color: true },
  { mode: 6, name: "Rainbow wheel", color: true },
  { mode: 7, name: "Key ripple", color: true },
  { mode: 8, name: "Starry", color: true },
  { mode: 9, name: "Reactive (snow trail)", color: true },
  { mode: 10, name: "Wave flow", color: true },
  { mode: 11, name: "Go with the flow", color: true },
  { mode: 12, name: "Shadow follow", color: true },
  { mode: 13, name: "Sine wave", color: true },
  { mode: 14, name: "Scan", color: true },
  { mode: 15, name: "Windmill", color: true },
  { mode: 16, name: "Waterfall", color: true },
  { mode: 17, name: "Blossom", color: true },
  { mode: 18, name: "Spinning storm", color: true },
  { mode: 19, name: "Custom (per-key)", color: false },
];

export const SIDE_MODES = [
  { mode: 0, name: "Off" },
  { mode: 3, name: "Static" },
  { mode: 1, name: "Wave flow" },
  { mode: 4, name: "Breathing" },
  { mode: 2, name: "Neon" },
  { mode: 5, name: "Racing" },
];

export const MAIN_LIMITS = { bright: 20, speed: 4 };
export const SIDE_LIMITS = { bright: 4, speed: 4 };
