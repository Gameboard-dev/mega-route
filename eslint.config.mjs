// Obsidian's own lint rules (eslint-plugin-obsidianmd, the rules of the community directory's review), with
// typescript-eslint's type-checked rules, over the plugin's sources. `npm run lint`; part of the release check and CI.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "tests/**", "scripts/**", "*.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // MEGA's product names keep MEGA's spelling (the rule's own option for brand names).
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["Obsidian", "MEGA", "MEGAcmd", "MEGA-Route", "MEGAsync", "SyncDebris"] }],
    },
  },
]);
