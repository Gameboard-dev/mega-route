// Builds main.js from src/main.ts. `node esbuild.config.mjs production` for the release build, without arguments to
// rebuild on every change. esbuild does not check types: `npm run typecheck` does.
import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const prod = process.argv[2] === "production";

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  // Obsidian provides these at run time; Node's modules are required only in the desktop app (src/node.ts).
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  format: "cjs",
  target: "es2021",
  // src/node.ts loads Node's modules with import() (on the desktop only); written as require() calls here, which
  // Obsidian's plugin loader provides, rather than left to the renderer's own module loader.
  supported: { "dynamic-import": false },
  platform: "browser",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: false,
  legalComments: "inline",
  outfile: "main.js",
  banner: {
    js: "/* MEGA-Route, an Obsidian plugin (MIT licence). Built with esbuild from the TypeScript in src/: https://github.com/Gameboard-dev/mega-route */",
  },
};

if (prod) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
}
