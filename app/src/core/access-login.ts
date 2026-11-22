// A logged-out Cloudflare Access tunnel opens a login page per connection; after a few in a minute it is stopped.

/** What `cloudflared access token` says on stderr when there is no session, or only an expired one. */
export const noSession = (stderr: string): boolean => stderr.includes('Unable to find token');
/** A login that never prints the token, and closes its page once done. */
export const loginArgs = (host: string): string[] => ['access', 'login', '--quiet', '--auto-close', `https://${host}`];

/** What cloudflared prints each time it opens a login page. */
export const LOGIN_PROMPT = 'A browser window should have opened';
const NEEDS_LOGIN = 'koppler: needs login.';
const LIMIT = 3;
const WINDOW = 60_000;

/** The prompt times still inside the window. */
export const recentPrompts = (times: number[], now: number): number[] => times.filter(time => now - time < WINDOW);
export const tooManyPrompts = (times: number[], now: number): boolean => recentPrompts(times, now).length >= LIMIT;

/** The login command for the host a tunnel's command names. */
function loginFor(command: string[]): string {
  const at = command.indexOf('--hostname');
  const host = at >= 0 ? command[at + 1] : undefined;
  return `cloudflared access login ${host ? `https://${host}` : '<its address>'}`;
}

/** The line the tunnel's log ends on: how to log in. */
export const needsLoginLine = (command: string[]): string =>
  `${NEEDS_LOGIN} Cloudflare Access asked ${String(LIMIT)} times in a minute, so the tunnel is stopped. Run ${loginFor(command)}, then koppler up again.`;

/** What the canvas inbox says, with the login command to copy. */
export const needsLoginMessage = (name: string, command: string[]) => ({
  kind: 'failure',
  from: 'koppler' as const,
  title: `${name} needs a Cloudflare Access login`,
  summary: `Access asked ${String(LIMIT)} times in a minute, so Koppler stopped the tunnel before it opened more browser pages.`,
  sections: [{ title: '', items: ['Log in, then run the board again.'], commands: [loginFor(command)] }],
});

/** Whether a stopped process's last log line says it needs a login. */
export const needsLogin = (lastLine: string): boolean => lastLine.startsWith(NEEDS_LOGIN);
