// What a Send will do: the board the user wants, compared with the board last applied and with what is really running.
// Shared by the canvas (as a browser global), the watcher and the koppler command, so the user is shown exactly what the agent then does.
(function (root) {
  // A board in one shape: { env, nodes: { id: { branch, run, platform?, note?, tunnels?, changes? } }, edges: [{ from, to }], queues: { id: 'local' } }.
  function board(input) {
    const list = Array.isArray(input?.nodes) ? input.nodes.map(n => [n.id, n]) : Object.entries(input?.nodes ?? {});
    const nodes = Object.fromEntries(list.filter(([id]) => typeof id === 'string').map(([id, n]) => [id, { branch: n?.branch || '', run: n?.run || 'cli', ...(n?.platform && { platform: n.platform }), ...(n?.note && { note: String(n.note) }), ...(n?.tunnels === false && { tunnels: false }), ...(n?.changes && { changes: String(n.changes) }), ...(Array.isArray(n?.libraries) && n.libraries.length && { libraries: [...n.libraries].sort() }) }]));
    const edges = (Array.isArray(input?.edges) ? input.edges : []).filter(e => e && nodes[e.from] && nodes[e.to]).map(e => ({ from: e.from, to: e.to }));
    const queues = Object.fromEntries(Object.entries(input?.queues ?? {}).filter(([, v]) => v === 'local'));
    return { env: input?.env ?? null, nodes, edges, queues };
  }
  const callees = (b, id) => b.edges.filter(e => e.from === id).map(e => e.to).sort();

  // opts: name(id) for wording, running(id) -> true | false | undefined (unknown) for what Koppler itself is running now,
  // strays: ids Koppler is running that no applied board explains; startedOn(id): the environment `koppler run <app>` started one on;
  // queuesOf(id): the queues the app publishes to or reads.
  function plan(liveInput, desiredInput, opts) {
    const o = opts || {}, name = id => (o.name ? o.name(id) : id), live = board(liveInput), want = board(desiredInput);
    const envName = e => String(e ?? '').toUpperCase(), envChange = live.env && want.env && live.env !== want.env && Object.keys(live.nodes).length ? { from: live.env, to: want.env } : null;
    const starts = [], restarts = [], stops = [], keeps = [];
    for (const id of Object.keys(want.nodes)) {
      const now = live.nodes[id], next = want.nodes[id], up = o.running ? o.running(id) : undefined;
      if (!now) {
        // Started by id on this environment and calling nothing local: it already is what the board asks for.
        const adopt = (o.strays || []).includes(id) && o.startedOn && o.startedOn(id) === want.env && !callees(want, id).length && !next.note && !next.branch;
        if (adopt) keeps.push({ id, why: ['you started it with koppler run'] });
        else if ((o.strays || []).includes(id)) restarts.push({ id, why: ['it is running, but not from a run Koppler recorded'] });
        else starts.push({ id, why: [] });
        continue;
      }
      if (up === false && next.run !== 'ide') { starts.push({ id, why: ['it was started before but is not running now'] }); continue; }
      const why = [];
      if (envChange) why.push(`the environment changes from ${envName(envChange.from)} to ${envName(envChange.to)}`);
      if (now.branch !== next.branch) why.push(`its branch changes from ${now.branch || 'the current one'} to ${next.branch || 'the current one'}`);
      if (now.run !== next.run) why.push(`it moves from ${now.run === 'ide' ? 'your IDE' : 'the command line'} to ${next.run === 'ide' ? 'your IDE' : 'the command line'}`);
      if ((now.platform || '') !== (next.platform || '') && next.run === 'cli') why.push(`its device changes to ${next.platform}`);
      const before = callees(live, id), after = callees(want, id);
      for (const c of after.filter(x => !before.includes(x))) why.push(`it starts calling your local ${name(c)}`);
      for (const c of before.filter(x => !after.includes(x))) why.push(`it goes back to the deployed ${name(c)}`);
      if ((now.note || '') !== (next.note || '')) why.push('its note changed');
      // Libraries switched to (or away from) the local copy are picked up when it starts again.
      for (const l of (next.libraries || []).filter(l => !(now.libraries || []).includes(l))) why.push(`it uses your local ${l}`);
      for (const l of (now.libraries || []).filter(l => !(next.libraries || []).includes(l))) why.push(`it goes back to the published ${l}`);
      // An app on a queue that moves between local and deployed starts again with the other queue's address.
      for (const q of (o.queuesOf ? o.queuesOf(id) : [])) if (!!live.queues[q] !== !!want.queues[q]) why.push(`it moves to the ${want.queues[q] ? 'local' : 'deployed'} ${q} queue`);
      (why.length ? restarts : keeps).push({ id, why });
    }
    for (const id of [...Object.keys(live.nodes), ...(o.strays || [])]) if (!want.nodes[id] && !stops.some(s => s.id === id)) stops.push({ id, why: [] });
    return { env: want.env, envChange, starts, restarts, stops, keeps, nothing: !starts.length && !restarts.length && !stops.length };
  }

  // The plan in plain lines, for the review before Send, the prompt and the terminal.
  function describe(p, opts) {
    const name = id => (opts && opts.name ? opts.name(id) : id), lines = [];
    const list = (title, items) => { if (items.length) lines.push(`${title}: ${items.map(x => name(x.id) + (x.why.length ? ` (${x.why.join('; ')})` : '')).join(', ')}`); };
    list('START', p.starts); list('RESTART', p.restarts); list('STOP AND REVERT', p.stops); list('KEEP RUNNING', p.keeps);
    return lines.length ? lines : ['NOTHING TO CHANGE'];
  }
  // True when two plans would do the same things for the same reasons.
  const same = (a, b) => JSON.stringify(['starts', 'restarts', 'stops', 'keeps'].map(k => (a?.[k] ?? []).map(x => x.id).sort())) === JSON.stringify(['starts', 'restarts', 'stops', 'keeps'].map(k => (b?.[k] ?? []).map(x => x.id).sort()));

  // Queue types a stack can name, and the ones Koppler can run on this Mac (in an AWS emulator).
  const QUEUE_TYPES = ['sqs', 'sns', 'eventbridge', 'kafka', 'other'], LOCAL_QUEUE_TYPES = ['sqs', 'kafka'];
  // The queues an app publishes to or reads, from the stack.
  const queuesOf = (registry, id) => { const a = registry?.apps?.[id] ?? {}; return [...new Set([...Object.keys(a.publishes ?? {}), ...Object.keys(a.reads ?? {})])]; };

  // The environments where a mistake costs something (production, usually): the stack names them in `protected`;
  // without that, every environment except the first. They get the red frame, a review that blocks on what is
  // missing, and secrets that ask on every read. Never decided by an environment's name.
  const protectedEnvs = registry => { const envs = (registry && registry.envs) || []; return Array.isArray(registry && registry.protected) ? envs.filter(e => registry.protected.includes(e)) : envs.slice(1); };
  const isProtected = (registry, env) => protectedEnvs(registry).includes(env);
  const api = { board, plan, describe, same, queuesOf, QUEUE_TYPES, LOCAL_QUEUE_TYPES, protectedEnvs, isProtected };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KopplerPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
