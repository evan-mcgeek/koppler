// Plans tunnels so no two want the same local port. A tunnel is one host and port: apps that need the same one share
// it. When different hosts want the same port, one keeps it; a tunnel whose address is a setting moves to a free
// port; one that cannot move keeps its port on its own loopback address, which needs a one-time sudo step.

/** One app's need for a tunnel, as the stack states it. */
export interface TunnelNeed {
  app: string;
  /** The host the tunnel reaches. */
  tunnel: string;
  port: number;
  /** The app's setting that holds the tunnel's address; with it, the tunnel can move to another port. */
  env?: string | undefined;
  what?: string | undefined;
  /** The name the app dials, when that is not the tunnel's host (a database endpoint taken from a secret). */
  connectsAs?: string | undefined;
}
export interface Tunnel {
  host: string;
  port: number;
  /** The port the stack asked for. */
  original: number;
  /** The local address it listens on: localhost, or an address of its own when it shares its port. */
  bind: string;
  apps: string[];
  /** Per app, the setting that holds the tunnel's address. */
  envs: Record<string, string>;
  what: string;
  connectsAs?: string | undefined;
  /** Set when the tunnel moved: what each of its apps has to be started with. */
  settings?: { app: string; env: string; value: string }[];
  needsAlias?: true;
}

// What a tunnel reaches: the stack's `what`, else a guess from the host name, else a plain tunnel.
const ENGINES = [
  ['valkey', 'Cache (Valkey)'],
  ['redis', 'Cache (Redis)'],
  ['aurora', 'Database (Aurora)'],
  ['postgres', 'Database (Postgres)'],
  ['mysql', 'Database (MySQL)'],
  ['mongo', 'Database (MongoDB)'],
  ['db', 'Database'],
  ['rds', 'Database'],
] as const;
export function tunnelKind(need: { tunnel?: string | undefined; what?: string | undefined }): string {
  if (need.what) return need.what;
  const host = (need.tunnel ?? '').toLowerCase();
  const parts = host.split(/[.-]/);
  return ENGINES.find(([key]) => parts.includes(key) || (key.length > 3 && host.includes(key)))?.[1] ?? 'Tunnel';
}

function gather(needs: TunnelNeed[]): Tunnel[] {
  const byKey = new Map<string, Tunnel>();
  for (const need of needs) {
    const key = `${need.tunnel}:${String(need.port)}`;
    const tunnel = byKey.get(key) ?? {
      host: need.tunnel,
      port: need.port,
      original: need.port,
      bind: 'localhost',
      apps: [],
      envs: {},
      what: tunnelKind(need),
      connectsAs: need.connectsAs,
    };
    if (!tunnel.apps.includes(need.app)) tunnel.apps.push(need.app);
    if (need.env) tunnel.envs[need.app] = need.env;
    byKey.set(key, tunnel);
  }
  return [...byKey.values()];
}

/** The tunnels a set of apps needs. `takenPorts` are ports something else will use, the apps' own among them. */
export function planTunnels(needs: TunnelNeed[], takenPorts: number[] = []): Tunnel[] {
  const tunnels = gather(needs);
  const taken = new Set([...takenPorts, ...tunnels.map(t => t.port)]);
  const movable = (t: Tunnel) => t.apps.every(app => t.envs[app]);
  let alias = 2;
  for (const port of new Set(tunnels.map(t => t.original))) {
    const wanting = tunnels.filter(t => t.original === port);
    // The first keeps the port: one that cannot move, when there is one.
    wanting.sort((a, b) => Number(movable(a)) - Number(movable(b)));
    for (const tunnel of wanting.slice(1)) {
      if (movable(tunnel)) {
        let next = port + 2;
        while (taken.has(next)) next++;
        taken.add(next);
        tunnel.port = next;
        tunnel.settings = tunnel.apps.map(app => ({
          app,
          env: tunnel.envs[app] ?? '',
          value: `localhost:${String(next)}`,
        }));
      } else {
        tunnel.bind = `127.0.0.${String(alias++)}`;
        tunnel.needsAlias = true;
      }
    }
  }
  return tunnels;
}

/** One plain sentence per tunnel that does not simply run as declared. */
export function describePlan(tunnels: Tunnel[], name: (app: string) => string = app => app): string[] {
  const kind = (t: Tunnel) =>
    t.what !== 'Tunnel' ? `${t.what.replace(/ \(.*\)$/, '').toLowerCase()} tunnel` : 'tunnel';
  const whose = (t: Tunnel) => `${t.apps.map(name).join(' and ')}'s ${kind(t)}`;
  return tunnels.flatMap(t => {
    const others = tunnels
      .filter(o => o !== t && o.original === t.original)
      .map(whose)
      .join(' and ');
    const port = String(t.port);
    if (t.settings)
      return [`${whose(t)} moves from port ${String(t.original)} to ${port}, to make room for ${others}.`];
    if (t.needsAlias)
      return [
        `${whose(t)} keeps port ${port} on its own address, ${t.bind}, next to ${others}. Needs a one-time sudo step.`,
      ];
    if (t.apps.length > 1) return [`${t.apps.map(name).join(' and ')} share one ${kind(t)} on port ${port}.`];
    return [];
  });
}

/** A value as one shell word, for the commands shown to the user to paste. */
const shellWord = (value: string) => (/^[\w.:@/-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

export interface TunnelSteps {
  /** The name Koppler runs the tunnel under. */
  name: string;
  /** Commands for the user's own terminal, when the tunnel needs an address of its own. */
  sudo: string[];
  undo: string[];
  /** The tunnel program and its arguments: run as a list, never through a shell. */
  tunnelArgs: string[];
  /** The same as text, only to show. */
  tunnel: string;
  settings: NonNullable<Tunnel['settings']>;
}

/**
 * The commands and settings that carry one tunnel of a plan out. An address of its own moves the name the app dials
 * to that address: off any hosts line that maps it already, since the first match wins, with a backup to undo.
 */
export function planSteps(
  t: Pick<Tunnel, 'host' | 'port' | 'bind' | 'connectsAs' | 'settings' | 'needsAlias'>,
): TunnelSteps {
  const url = `${t.bind}:${String(t.port)}`;
  const dialed = t.connectsAs ?? t.host;
  const pattern = dialed.replace(/[^\w-]/g, c => `\\${c}`);
  // Two tunnels can share a port, each on its own address: the address is then part of the name.
  const name = `tunnel-${t.host.split('.')[0] ?? ''}-${String(t.port)}${t.needsAlias ? `-on-${t.bind}` : ''}`;
  return {
    name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    sudo: t.needsAlias
      ? [
          `sudo ifconfig lo0 alias ${shellWord(t.bind)} up`,
          `sudo sed -i .koppler.bak -E ${shellWord(`s/[[:space:]]+${pattern}([[:space:]]|$)/\\1/`)} /etc/hosts`,
          `echo ${shellWord(`${t.bind} ${dialed}`)} | sudo tee -a /etc/hosts`,
        ]
      : [],
    undo: t.needsAlias
      ? ['sudo mv /etc/hosts.koppler.bak /etc/hosts', `sudo ifconfig lo0 -alias ${shellWord(t.bind)}`]
      : [],
    tunnelArgs: ['cloudflared', 'access', 'tcp', '--hostname', t.host, '--url', url],
    tunnel: `cloudflared access tcp --hostname ${shellWord(t.host)} --url ${shellWord(url)}`,
    settings: t.settings ?? [],
  };
}

/**
 * Whether a tunnel on its own address can start: the name its app dials leads there (the first hosts line that names
 * it wins) and the address exists. `addresses` is the loopback interface as ifconfig prints it, or null where every
 * 127.x.x.x address exists without being added.
 */
export function aliasReady(
  t: Pick<Tunnel, 'host' | 'bind' | 'connectsAs'>,
  hosts: string,
  addresses: string | null,
): boolean {
  const dialed = t.connectsAs ?? t.host;
  const words = (line: string) => line.replace(/#.*/, '').trim().split(/\s+/);
  const first = hosts
    .split('\n')
    .map(words)
    .find(([, ...names]) => names.includes(dialed));
  const exists =
    addresses === null || addresses.split('\n').some(line => words(line).slice(0, 2).join(' ') === `inet ${t.bind}`);
  return first?.[0] === t.bind && exists;
}
