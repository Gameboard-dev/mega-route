// Sets the version in manifest.json and versions.json. Run by `npm version <x.y.z>` (which passes the new version in
// npm_package_version), or by hand: node version-bump.mjs 3.0.1
import fs from "fs";

const target = process.argv[2] || process.env.npm_package_version;
if (!target || !/^\d+\.\d+\.\d+$/.test(target)) {
  console.error("Usage: node version-bump.mjs <x.y.z>");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
manifest.version = target;
versions[target] = manifest.minAppVersion;
fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
console.log(`manifest.json and versions.json set to ${target}`);
