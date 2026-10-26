/**
 * Extract the pristine upstream 0.18 plugins dialog implementation from the
 * checksum-pinned baseline renderer and report its structure.
 *
 * Read-only: reads the baseline file, prints byte-sliced regions.
 */

import { readFile } from "node:fs/promises";

const file = process.argv[2];
const source = await readFile(file, "utf8");

/** Decode \uXXXX escapes so Chinese labels become readable. */
const decoded = source.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const needles = process.argv.slice(3);

for (const needle of needles) {
  let index = -1;
  let count = 0;
  while ((index = decoded.indexOf(needle, index + 1)) !== -1) {
    count += 1;
    const start = Math.max(0, index - 700);
    const end = Math.min(decoded.length, index + 700);
    console.log(`\n=== "${needle}" occurrence ${count} @ byte ${index} ===`);
    console.log(decoded.slice(start, end));
    if (count >= 3) break;
  }
  if (count === 0) console.log(`\n=== "${needle}": NOT FOUND ===`);
}
