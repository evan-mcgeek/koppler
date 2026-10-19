// Puts what the package carries from the repo's root into it: the agent skill, at the root an npm plugin source reads,
// with the version it belongs to, and the README and LICENSE, the README's links and images made absolute for npmjs.com.
// Usage: node scripts/pack-skill.mjs [--clean]   (prepack copies them in, postpack takes them out again)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(app, '..');
const into = path.join(app, 'skills');
const copies = [into, path.join(app, 'README.md'), path.join(app, 'LICENSE')];
for (const copy of copies) fs.rmSync(copy, { recursive: true, force: true });
if (!process.argv.includes('--clean')) {
  fs.cpSync(path.join(root, 'plugin', 'skills'), into, { recursive: true });
  const { version, repository } = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  for (const skill of fs.readdirSync(into)) fs.writeFileSync(path.join(into, skill, 'VERSION'), `${version}\n`);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(app, 'LICENSE'));
  const repo = repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  // The release's own tag, so a published README keeps its pictures after main changes.
  const ref = `v${version}`;
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  // A path in the repo, from the README at its root: a page on GitHub.
  const absolute = readme
    .replace(/\]\((?![a-z]+:|#)([^)]+)\)/g, (_, link) => `](${repo}/blob/${ref}/${link})`)
    // Its images, from GitHub's raw files: a page link would show no picture.
    .replace(
      /\b(src|srcset)="(?![a-z]+:)([^"]+)"/g,
      (_, attribute, file) =>
        `${attribute}="${repo.replace('github.com', 'raw.githubusercontent.com')}/${ref}/${file}"`,
    );
  fs.writeFileSync(path.join(app, 'README.md'), absolute);
}
