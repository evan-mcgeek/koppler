// An AWS profile signed in through an `sso-session`: the AWS CLI keeps that sign-in under the session's name, while
// older AWS SDKs (such as the AWS SDK for .NET 3.7) look it up under the start URL, and ask for their own browser
// sign-in when their copy there has expired. Only file names and expiry times are read here, never a token.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sections = (text: string): Map<string, Record<string, string>> => {
  const found = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;
  for (const line of text.split('\n')) {
    const header = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line)?.[1];
    if (header) found.set(header.replace(/\s+/g, ' '), (current = {}));
    const [, key, value] = /^\s*([\w-]+)\s*=\s*(.*?)\s*$/.exec(line) ?? [];
    if (current && key && value !== undefined) current[key] = value;
  }
  return found;
};

/**
 * For a profile with an `sso-session`: its start URL and whether an older SDK's copy of the sign-in still holds. Null
 * for any other profile, or when the AWS config cannot be read.
 */
export function sdkSignIn(profile: string): { startUrl: string; holds: boolean } | null {
  let text: string;
  try {
    text = fs.readFileSync(process.env['AWS_CONFIG_FILE'] ?? path.join(os.homedir(), '.aws', 'config'), 'utf8');
  } catch {
    return null;
  }
  const all = sections(text);
  const session = all.get(profile === 'default' ? 'default' : `profile ${profile}`)?.['sso_session'];
  const startUrl = session ? all.get(`sso-session ${session}`)?.['sso_start_url'] : undefined;
  if (!startUrl) return null;
  const cached = path.join(
    os.homedir(),
    '.aws',
    'sso',
    'cache',
    `${createHash('sha1').update(startUrl).digest('hex')}.json`,
  );
  let expiresAt: unknown;
  try {
    ({ expiresAt } = JSON.parse(fs.readFileSync(cached, 'utf8')) as { expiresAt?: unknown });
  } catch {
    return { startUrl, holds: false };
  }
  return { startUrl, holds: typeof expiresAt === 'string' && Date.parse(expiresAt) > Date.now() };
}

/** The page an AWS device sign-in is approved on, for a start URL. */
export const devicePage = (startUrl: string): string => `${startUrl.replace(/\/*$/, '/')}#/device`;

/** A device sign-in an app's log asks for: the page to open and the code to enter. */
export function devicePrompt(log: string): { page: string; code: string } | null {
  const [, page, code] = /(https:\/\/\S*device\S*)[\s\S]{0,200}?\bcode:?\s+([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(log) ?? [];
  return page && code ? { page, code } : null;
}
