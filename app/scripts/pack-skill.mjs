// Puts the agent skill in the package, at the root an npm plugin source reads, with the version it belongs to.
// Usage: node scripts/pack-skill.mjs [--clean]   (prepack copies it in, postpack takes it out again)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const into = path.join(app, 'skills');
fs.rmSync(into, { recursive: true, force: true });
if (!process.argv.includes('--clean')) {
  fs.cpSync(path.join(app, '..', 'plugin', 'skills'), into, { recursive: true });
  const { version } = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  for (const skill of fs.readdirSync(into)) fs.writeFileSync(path.join(into, skill, 'VERSION'), `${version}\n`);
}
