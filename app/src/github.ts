// Files on GitHub, read and proposed through the user's own `gh` login. Only https links to a file on github.com are accepted.
import { execFile } from 'node:child_process';

/** One file in a repository on GitHub, at a branch or commit. */
export interface GithubFile {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

export function githubFile(link: string): GithubFile | null {
  let url: URL;
  let parts: string[];
  try {
    url = new URL(link);
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (!parts.every(part => /^[\w.@+-]+$/.test(part) && part !== '..')) return null;
  const [owner = '', repo = '', third, fourth = ''] = parts;
  // ponytail: a branch name containing "/" is read as ref + path; link to a commit or a plain branch instead
  if (url.hostname === 'github.com' && third === 'blob' && parts.length > 4)
    return { owner, repo, ref: fourth, path: parts.slice(4).join('/') };
  if (url.hostname === 'raw.githubusercontent.com' && parts.length > 3) {
    const [ref = '', ...rest] = parts
      .slice(2)
      .join('/')
      .replace(/^refs\/heads\//, '')
      .split('/');
    return { owner, repo, ref, path: rest.join('/') };
  }
  return null;
}
export const fileUrl = (file: GithubFile): string =>
  `https://github.com/${file.owner}/${file.repo}/blob/${file.ref}/${file.path}`;

const MAX_BYTES = 1024 * 1024;
/** `gh api`, with an optional JSON body on stdin. */
export function gh(args: string[], body?: object): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise(resolve => {
    const child = execFile(
      'gh',
      ['api', ...args, ...(body ? ['--input', '-'] : [])],
      { timeout: 30000, maxBuffer: MAX_BYTES },
      (error, stdout, stderr) => {
        resolve({ ok: !error, out: stdout, err: stderr });
      },
    );
    child.stdin?.end(body ? JSON.stringify(body) : undefined);
  });
}

/** The file's text through gh (private repos), else as a public file. */
export async function readFile(file: GithubFile): Promise<string | null> {
  const { owner, repo, ref, path } = file;
  const viaGh = await gh([
    `repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    '-H',
    'Accept: application/vnd.github.raw',
  ]);
  if (viaGh.ok) return viaGh.out;
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const fits = Number(response.headers.get('content-length') ?? 0) <= MAX_BYTES;
    return response.ok && fits ? (await response.text()).slice(0, MAX_BYTES) : null;
  } catch {
    return null;
  }
}

/** A pull request that replaces the file with `text` on a new branch off the linked ref. */
export async function proposeFile(
  file: GithubFile,
  text: string,
  { branch, title, body }: { branch: string; title: string; body: string },
): Promise<{ url: string; error?: undefined } | { error: string }> {
  const repo = `repos/${file.owner}/${file.repo}`;
  const base = await gh([`${repo}/commits/${encodeURIComponent(file.ref)}`, '--jq', '.sha']);
  if (!base.ok)
    return { error: "Could not read the shared stack's repo. Check that gh is signed in with access to it." };
  const made = await gh(['-X', 'POST', `${repo}/git/refs`], { ref: `refs/heads/${branch}`, sha: base.out.trim() });
  if (!made.ok) return { error: 'Could not create a branch. You may not be allowed to push to that repo.' };
  const blob = await gh([`${repo}/contents/${file.path}?ref=${encodeURIComponent(branch)}`, '--jq', '.sha']);
  const put = await gh(['-X', 'PUT', `${repo}/contents/${file.path}`], {
    message: title,
    content: Buffer.from(text).toString('base64'),
    branch,
    ...(blob.ok && { sha: blob.out.trim() }),
  });
  if (!put.ok) return { error: 'Could not commit the stack to the new branch.' };
  // A link to a commit has no branch to merge into; the repo's default branch is used then.
  const isBranch = !/^[0-9a-f]{7,40}$/.test(file.ref);
  const into = isBranch ? file.ref : (await gh([repo, '--jq', '.default_branch'])).out.trim();
  const opened = await gh(['-X', 'POST', `${repo}/pulls`, '--jq', '.html_url'], {
    title,
    head: branch,
    base: into,
    body,
  });
  return opened.ok
    ? { url: opened.out.trim() }
    : { error: 'The branch was pushed, but the pull request could not be opened.' };
}
