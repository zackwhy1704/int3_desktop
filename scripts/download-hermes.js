#!/usr/bin/env node
/**
 * Downloads the correct Hermes Agent binary for the current platform.
 *
 * Run this before every Tauri build:
 *   node scripts/download-hermes.js
 *   HERMES_VERSION=1.2.3 node scripts/download-hermes.js
 *
 * The binary is placed in src-tauri/binaries/ following Tauri's sidecar naming
 * convention: hermes-{arch}-{vendor}-{os}-{abi}[.exe]
 *
 * The binary is .gitignored — never commit it. CI downloads it fresh each run.
 *
 * Hermes releases: https://github.com/NousResearch/hermes-agent/releases
 */

import { createWriteStream, mkdirSync, existsSync, chmodSync } from "fs";
import { pipeline } from "stream/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = process.env.HERMES_VERSION ?? "latest";

/** Maps Node platform+arch to Tauri target triple and binary extension. */
const PLATFORM_MAP = {
  "win32-x64":    { target: "x86_64-pc-windows-msvc",    ext: ".exe" },
  "darwin-arm64": { target: "aarch64-apple-darwin",       ext: ""     },
  "darwin-x64":   { target: "x86_64-apple-darwin",        ext: ""     },
  "linux-x64":    { target: "x86_64-unknown-linux-gnu",   ext: ""     },
};

const platformKey = `${process.platform}-${process.arch}`;
const mapping = PLATFORM_MAP[platformKey];

if (!mapping) {
  console.error(`Unsupported platform: ${platformKey}`);
  console.error(`Supported: ${Object.keys(PLATFORM_MAP).join(", ")}`);
  process.exit(1);
}

const outDir = join(__dirname, "..", "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });

const outFile = `hermes-${mapping.target}${mapping.ext}`;
const outPath = join(outDir, outFile);

// Build download URL.
// TODO: confirm the exact asset name pattern from the first Hermes release
// that ships a standalone gateway binary. Update this URL format accordingly.
// See: https://github.com/NousResearch/hermes-agent/releases
const baseUrl = "https://github.com/NousResearch/hermes-agent/releases";
const assetName = `hermes-gateway-${mapping.target}${mapping.ext}`;
const url =
  VERSION === "latest"
    ? `${baseUrl}/latest/download/${assetName}`
    : `${baseUrl}/download/v${VERSION}/${assetName}`;

console.log(`Hermes binary download`);
console.log(`  version:  ${VERSION}`);
console.log(`  platform: ${platformKey} → ${mapping.target}`);
console.log(`  url:      ${url}`);
console.log(`  dest:     ${outPath}`);

if (existsSync(outPath) && process.env.FORCE_DOWNLOAD !== "1") {
  console.log("Binary already exists. Set FORCE_DOWNLOAD=1 to re-download.");
  process.exit(0);
}

const res = await fetch(url);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  console.error("Check that the Hermes version and asset name are correct.");
  process.exit(1);
}

await pipeline(res.body, createWriteStream(outPath));

if (process.platform !== "win32") {
  chmodSync(outPath, 0o755);
}

console.log("Done.");
