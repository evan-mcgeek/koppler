// Files on GitHub, read and proposed through the user's own `gh` login. Only https links to a file on github.com are accepted.
import { execFile } from 'node:child_process';

export function githubFile(link) {
  let u; try { u = new URL(link); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const safe = parts.every(x => /^[\w.@+-]+$/.test(x) && x !== '..');
  // ponytail: a branch name containing "/" is read as ref + path; link to a commit or a plain branch instead
  if (u.hostname === 'github.com' && parts[2] === 'blob' && parts.length > 4 && safe) return { owner: parts[0], repo: parts[1], ref: parts[3], path: parts.slice(4).join('/') };
  if (u.hostname === 'raw.githubusercontent.com' && parts.length > 3 && safe) { const rest = parts.slice(2).join('/').replace(/^refs\/heads\//, '').split('/'); return { owner: parts[0], repo: parts[1], ref: rest[0], path: rest.slice(1).join('/') }; }
  return null;
}
export const fileUrl = f => `https://github.com/${f.owner}/${f.repo}/blob/${f.ref}/${f.path}`;

const MAX_BYTES = 1024 * 1024;
// `gh api`, with an optional JSON body on stdin. Resolves { ok, out }.
export function gh(args, body) {
  return new Promise(resolve => {
    const child = execFile('gh', ['api', ...args, ...(body ? ['--input', '-'] : [])], { timeout: 30000, maxBuffer: MAX_BYTES }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout), err: String(stderr) }));
    child.stdin.end(body ? JSON.stringify(body) : undefined);
  });
}

// The file's text through gh (private repos), else as a public file.
export async function readFile(f) {
  const viaGh = await gh([`repos/${f.owner}/${f.repo}/contents/${f.path}?ref=${encodeURIComponent(f.ref)}`, '-H', 'Accept: application/vnd.github.raw']);
  if (viaGh.ok) return viaGh.out;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${f.owner}/${f.repo}/${f.ref}/${f.path}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    return res.ok && Number(res.headers.get('content-length') ?? 0) <= MAX_BYTES ? (await res.text()).slice(0, MAX_BYTES) : null;
  } catch { return null; }
}

// A pull request that replaces the file with `text` on a new branch off the linked ref. Returns { url } or { error }.
export async function proposeFile(f, text, { branch, title, body }) {
  const repo = `repos/${f.owner}/${f.repo}`;
  const base = await gh([`${repo}/commits/${encodeURIComponent(f.ref)}`, '--jq', '.sha']);
  if (!base.ok) return { error: 'Could not read the shared stack\'s repo. Check that gh is signed in with access to it.' };
  const made = await gh(['-X', 'POST', `${repo}/git/refs`], { ref: `refs/heads/${branch}`, sha: base.out.trim() });
  if (!made.ok) return { error: 'Could not create a branch. You may not be allowed to push to that repo.' };
  const blob = await gh([`${repo}/contents/${f.path}?ref=${encodeURIComponent(branch)}`, '--jq', '.sha']);
  const put = await gh(['-X', 'PUT', `${repo}/contents/${f.path}`], { message: title, content: Buffer.from(text).toString('base64'), branch, ...(blob.ok && { sha: blob.out.trim() }) });
  if (!put.ok) return { error: 'Could not commit the stack to the new branch.' };
  // A link to a commit has no branch to merge into; the repo's default branch is used then.
  const isBranch = !/^[0-9a-f]{7,40}$/.test(f.ref);
  const into = isBranch ? f.ref : (await gh([repo, '--jq', '.default_branch'])).out.trim();
  const pr = await gh(['-X', 'POST', `${repo}/pulls`, '--jq', '.html_url'], { title, head: branch, base: into, body });
  return pr.ok ? { url: pr.out.trim() } : { error: 'The branch was pushed, but the pull request could not be opened.' };
}
