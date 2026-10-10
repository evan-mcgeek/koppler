// Plans tunnels so no two want the same local port. Shared by the canvas (as a browser global) and the koppler command.
// A tunnel is one host and port: apps that need the same one share it. When different hosts want the same port,
// one keeps it; a tunnel whose address is a setting (`env` on the tunnel) moves to a free port; one that cannot move
// keeps its port on its own loopback address, which needs a loopback alias and a hosts entry (sudo).
(function (root) {
  // What a tunnel reaches: the stack's `what`, else a guess from the host name, else a plain tunnel.
  const ENGINES = [['valkey', 'Cache (Valkey)'], ['redis', 'Cache (Redis)'], ['aurora', 'Database (Aurora)'], ['postgres', 'Database (Postgres)'], ['mysql', 'Database (MySQL)'], ['mongo', 'Database (MongoDB)'], ['db', 'Database'], ['rds', 'Database']];
  function tunnelKind(p) {
    if (p.what) return p.what;
    const host = String(p.tunnel || '').toLowerCase(), parts = host.split(/[.-]/);
    const hit = ENGINES.find(([k]) => parts.includes(k) || (k.length > 3 && host.includes(k)));
    return hit ? hit[1] : 'Tunnel';
  }

  function planTunnels(entries, takenPorts) {
    const taken = new Set(takenPorts || []);
    const byKey = new Map();
    for (const e of entries) {
      const key = `${e.tunnel}:${e.port}`;
      const t = byKey.get(key) || { host: e.tunnel, port: e.port, original: e.port, bind: 'localhost', apps: [], envs: {}, what: tunnelKind(e), connectsAs: e.connectsAs };
      if (!t.apps.includes(e.app)) t.apps.push(e.app);
      if (e.env) t.envs[e.app] = e.env;
      byKey.set(key, t);
    }
    const tunnels = [...byKey.values()];
    for (const t of tunnels) taken.add(t.port);
    const movable = t => t.apps.every(app => t.envs[app]);
    let alias = 2;
    const ports = [...new Set(tunnels.map(t => t.original))];
    for (const port of ports) {
      const here = tunnels.filter(t => t.original === port);
      if (here.length < 2) continue;
      here.sort((a, b) => Number(movable(a)) - Number(movable(b)));
      for (const t of here.slice(1)) {
        if (movable(t)) {
          let next = port + 2;
          while (taken.has(next)) next++;
          taken.add(next);
          t.port = next;
          t.settings = t.apps.map(app => ({ app, env: t.envs[app], value: `localhost:${next}` }));
        } else {
          t.bind = `127.0.0.${alias++}`;
          t.needsAlias = true;
        }
      }
    }
    return tunnels;
  }

  // One plain sentence per tunnel that does not simply run as declared.
  function describePlan(tunnels, nameOf) {
    const name = nameOf || (id => id);
    const kind = t => t.what && t.what !== 'Tunnel' ? `${t.what.replace(/ \(.*\)$/, '').toLowerCase()} tunnel` : 'tunnel';
    const whose = t => `${t.apps.map(name).join(' and ')}'s ${kind(t)}`;
    const lines = [];
    for (const t of tunnels) {
      const others = tunnels.filter(o => o !== t && o.original === t.original).map(whose);
      if (t.settings) lines.push(`${whose(t)} moves from port ${t.original} to ${t.port}, to make room for ${others.join(' and ')}.`);
      else if (t.needsAlias) lines.push(`${whose(t)} keeps port ${t.port} on its own address, ${t.bind}, next to ${others.join(' and ')}. Needs a one-time sudo step.`);
      else if (t.apps.length > 1) lines.push(`${t.apps.map(name).join(' and ')} share one ${kind(t)} on port ${t.port}.`);
    }
    return lines;
  }

  // The commands and settings that carry a plan out. A loopback alias moves the name the app dials (`connectsAs`, else
  // the tunnel host) to the alias: off any line that maps it already, since the first match wins, with a backup to undo.
  // A value as one shell word, for the commands shown to the user to paste.
  const q = v => /^[\w.:@\/-]+$/.test(String(v)) ? String(v) : `'${String(v).replace(/'/g, `'\\''`)}'`;
  function planSteps(t) {
    const url = `${t.bind}:${t.port}`, dialed = t.connectsAs || t.host, pattern = dialed.replace(/[^\w-]/g, c => `\\${c}`);
    return {
      // Two tunnels can share a port, each on its own address: the address is then part of the name.
      name: `tunnel-${t.host.split('.')[0]}-${t.port}${t.needsAlias ? `-on-${t.bind}` : ''}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      sudo: t.needsAlias ? [
        `sudo ifconfig lo0 alias ${q(t.bind)} up`,
        `sudo sed -i .koppler.bak -E ${q(`s/[[:space:]]+${pattern}([[:space:]]|$)/\\1/`)} /etc/hosts`,
        `echo ${q(`${t.bind} ${dialed}`)} | sudo tee -a /etc/hosts`,
      ] : [],
      undo: t.needsAlias ? ['sudo mv /etc/hosts.koppler.bak /etc/hosts', `sudo ifconfig lo0 -alias ${q(t.bind)}`] : [],
      // Run as a list of arguments, never through a shell; the text form is only shown.
      tunnelArgs: ['cloudflared', 'access', 'tcp', '--hostname', t.host, '--url', url],
      tunnel: `cloudflared access tcp --hostname ${q(t.host)} --url ${q(url)}`,
      settings: t.settings || [],
    };
  }

  // A tunnel on its own address can start once the name its app dials leads there (the first hosts line that names it
  // wins) and the address exists: `addresses` is the loopback interface as ifconfig prints it, or null where every
  // 127.x.x.x address exists without being added.
  function aliasReady(t, hosts, addresses) {
    const dialed = t.connectsAs || t.host;
    const first = String(hosts).split('\n').map(l => l.replace(/#.*/, '').trim().split(/\s+/)).find(([, ...names]) => names.includes(dialed));
    return first?.[0] === t.bind && (addresses == null || String(addresses).split('\n').some(l => l.trim().split(/\s+/).slice(0, 2).join(' ') === `inet ${t.bind}`));
  }

  const api = { tunnelKind, planTunnels, describePlan, planSteps, aliasReady };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KopplerPorts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
