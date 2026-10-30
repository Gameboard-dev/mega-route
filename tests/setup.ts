// Loaded before every test file (npm test: node --import ./tests/setup.ts). The plugin calls window.setTimeout and
// window.clearTimeout, as Obsidian asks (pop-out windows); under Node, `window` is Node's own global object.
const g = globalThis as { window?: unknown };
g.window ??= globalThis;
