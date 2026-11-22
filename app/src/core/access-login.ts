// A Cloudflare Access tunnel that is logged out asks for a login on every connection, each in a new browser page.
// After a few in a minute it is stopped, and its log ends on a line that says how to log in.

/** What cloudflared prints each time it opens a login page. */
export const LOGIN_PROMPT = 'A browser window should have opened';
const NEEDS_LOGIN = 'koppler: needs login.';
const LIMIT = 3;
const WINDOW = 60_000;

/** Whether the prompts seen so far (their times) are too many: an app keeps reconnecting while logged out. */
export const tooManyPrompts = (times: number[], now: number): boolean =>
  times.filter(time => now - time < WINDOW).length >= LIMIT;

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
