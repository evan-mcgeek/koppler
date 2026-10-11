// Finding the repos behind the names in a description ("the wallet API", "push notification service"): the stack first,
// then the clones on this Mac (koppler init's index), then GitHub in the user's own organisations through their gh login.
// Several candidates or none is a question for the user, never a guess; nothing is cloned here.
// Usage: koppler discover --find "<name> [<name>...]" [--json] [--no-github]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gh } from './github.ts';
import { readData } from './data.ts';

const CONFIG_DIR = process.env.KOPPLER_CONFIG_DIR || path.join(os.homedir(), '.config', 'koppler');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// "PushNotification-Service" and "push notification service" both become push / notification / service.
// Plurals count as the word ("notifications" finds "notification").
export const words = text => String(text).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !['the', 'a', 'an', 'api', 'app', 'service', 'svc'].includes(w)).map(w => w.length > 3 ? w.replace(/(?<!s)s$/, '') : w);
// How well a repo name or app name matches: the share of the asked words it contains ("pushnotifications" has both
// push and notification), with a small bonus for words standing on their own.
export function score(asked, candidate) {
  const want = words(asked), have = words(candidate), joined = have.join('');
  if (!want.length) return 0;
  const hits = want.filter(w => have.includes(w) || joined.includes(w)).length, whole = want.filter(w => have.includes(w)).length;
  return Math.min(1, hits / want.length + 0.1 * whole / want.length);
}
const slugOf = key => key.replace(/^[^/]+\//, '').replace(/\.git$/, '').toLowerCase();

export async function find(names, { registry, index = readJson(path.join(CONFIG_DIR, 'repos.json')), github = true } = {}) {
  const apps = Object.entries(registry?.apps ?? {}), clones = (index?.repos ?? []).filter(r => r.keys?.length && fs.existsSync(r.path));
  const orgs = [...new Set(clones.map(r => slugOf(r.keys[0]).split('/')[0]))].slice(0, 5);
  const out = [];
  for (const name of names) {
    // One entry per repo, whatever the case of its owner's name; the stack and a clone win over the same repo on GitHub.
    const found = new Map(), add = (slug, c) => { const key = slug.toLowerCase(), prev = found.get(key); if (!prev || c.score > prev.score) found.set(key, { slug, ...prev, ...c }); };
    for (const [id, app] of apps) { const s = Math.max(score(name, app.name ?? id), score(name, app.slug ?? '')); if (s >= 0.5) add(app.slug ?? id, { where: 'stack', app: id, name: app.name, score: s + 0.01 }); }
    for (const r of clones) { const slug = slugOf(r.keys[0]), s = score(name, slug.split('/').pop()); if (s >= 0.5 && !found.has(slug.toLowerCase())) add(slug, { where: 'clone', path: r.path, score: s }); }
    if (github && orgs.length) {
      // Any of the words, in the name: the scoring above keeps only the repos that really match.
      const q = encodeURIComponent(`${words(name).join(' OR ')} in:name ${orgs.map(o => `org:${o}`).join(' ')} fork:true`);
      const r = await gh([`search/repositories?q=${q}&per_page=8`]);
      if (r.ok) for (const it of JSON.parse(r.out).items ?? []) {
        const s = score(name, it.name);
        if (s >= 0.5 && !found.has(it.full_name.toLowerCase())) add(it.full_name, { where: 'github', description: (it.description ?? '').slice(0, 140), pushed: it.pushed_at?.slice(0, 10), archived: it.archived, score: s });
      }
      else out.githubError = r.err.split('\n')[0];
    }
    // Best match first; an archived repo is rarely the one meant, and of equals the more recently changed wins.
    const rank = c => c.score - (c.archived ? 0.3 : 0);
    out.push({ name, candidates: [...found.values()].sort((a, b) => rank(b) - rank(a) || String(b.pushed ?? '').localeCompare(String(a.pushed ?? ''))).slice(0, 6) });
  }
  return out;
}

export async function findCommand(args) {
  const names = args.filter(a => !a.startsWith('--'));
  if (!names.length) { console.error('usage: koppler discover --find "<name> [<name>...]" [--json] [--no-github]'); process.exit(1); }
  const res = await find(names, { registry: readData('registry'), github: !args.includes('--no-github') });
  if (args.includes('--json')) return console.log(JSON.stringify(res, null, 2));
  for (const r of res) {
    console.log(`\n${r.name}: ${r.candidates.length === 1 ? 'one match' : r.candidates.length ? `${r.candidates.length} candidates, ask which` : 'nothing found, ask the user'}`);
    for (const c of r.candidates) console.log(`  ${c.slug}  ${c.where === 'stack' ? `in the stack as ${c.app}` : c.where === 'clone' ? `cloned at ${c.path.replace(os.homedir(), '~')}` : `on GitHub${c.pushed ? `, last change ${c.pushed}` : ''}${c.archived ? ', archived' : ''}${c.description ? `: ${c.description}` : ''}; clone it only after the user says yes`}`);
  }
  if (res.githubError) console.log(`\n(GitHub was not searched: ${res.githubError})`);
}
