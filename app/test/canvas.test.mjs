// The canvas is one HTML file: every inline script must at least parse, or the page comes up blank.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(fileURLToPath(new URL('../src/canvas.html', import.meta.url)), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.ok(scripts.length > 0, 'canvas.html has inline scripts');
for (const [i, code] of scripts.entries()) assert.doesNotThrow(() => new vm.Script(code), `inline script ${i + 1} of canvas.html parses`);
