/**
 * Rebuilds lib/client.js from lib/client.template.js + assets/default-photo.b64.
 *
 * The shipped default background photo lives as raw base64 in
 * assets/default-photo.b64 (678 KB JPEG). The template keeps the readable
 * source; this script splices the base64 into the `<<DEFAULT_IMAGE_DATA>>`
 * placeholder and writes the deployable bundle.
 *
 * Usage: node scripts/build-client.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = join(root, "lib", "client.template.js");
const assetPath = join(root, "assets", "default-photo.b64");
const outPath = join(root, "lib", "client.js");

const template = readFileSync(templatePath, "utf8");
if (!template.includes("<<DEFAULT_IMAGE_DATA>>")) {
	throw new Error("template is missing the <<DEFAULT_IMAGE_DATA>> placeholder");
}
const base64 = readFileSync(assetPath, "utf8").replace(/\s+/g, "");
if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
	throw new Error("assets/default-photo.b64 contains non-base64 characters");
}
writeFileSync(outPath, template.replace("<<DEFAULT_IMAGE_DATA>>", base64));
console.log(
	`built ${outPath} (${(template.length + base64.length) / 1024 | 0} KB, default photo ${(base64.length * 3 / 4 / 1024) | 0} KB)`
);
