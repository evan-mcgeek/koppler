// Presets: bringing one saved in an older format up to date, and checking it against the stack before it opens.
// Shared by the canvas (as a browser global), the watcher and the koppler command.
(function (root) {
  const VERSION = 1;
  // One step per format version: MIGRATIONS[n] turns a version n preset into version n + 1.
  const MIGRATIONS = {
    // Version 0 had no version field; cables and how an app runs could be left out.
    0: p => ({ ...p, nodes: Object.fromEntries(Object.entries(p.nodes).map(([id, n]) => [id, { run: 'cli', ...(n && typeof n === 'object' ? n : {}) }])), edges: Array.isArray(p.edges) ? p.edges : [] }),
  };
  const versionOf = p => Number.isInteger(p?.version) && p.version >= 0 ? p.version : 0;

  // The preset in the current format, or the reason it cannot be read.
  function migrate(preset) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return { error: 'It is not a preset.' };
    if (typeof preset.name !== 'string' || !preset.name.trim()) return { error: 'It has no name.' };
    if (!preset.nodes || typeof preset.nodes !== 'object' || Array.isArray(preset.nodes) || !Object.keys(preset.nodes).length) return { error: 'It has no apps.' };
    const from = versionOf(preset);
    if (from > VERSION) return { error: `It was saved by a newer Koppler (preset format ${from}, this one reads up to ${VERSION}). Update Koppler.` };
    let p = preset;
    for (let v = from; v < VERSION; v++) p = { ...MIGRATIONS[v](p), version: v + 1 };
    // Whatever wrote it: every app is an object and the cables are a list.
    p = { ...p, nodes: Object.fromEntries(Object.entries(p.nodes).map(([id, n]) => [id, n && typeof n === 'object' && !Array.isArray(n) ? n : {}])), edges: Array.isArray(p.edges) ? p.edges : [] };
    return { preset: p, migratedFrom: from < VERSION ? from : null };
  }

  // Checks a preset against the stack. `stack` answers: known(id), cloned(id), mobile(id), runIn(id) -> allowed values,
  // platforms(id), canCall(from, to), branches(id) -> list or null when unknown.
  // Returns the preset as it will open (only what the stack can run) with notes on what changed, or an error.
  function check(input, stack) {
    const m = migrate(input);
    if (m.error) return { error: m.error };
    const p = m.preset, notes = [], name = id => stack.name ? stack.name(id) : id;
    if (!Number.isInteger(input.version)) notes.push('it had no version, read as the oldest format');
    const unknown = Object.keys(p.nodes).filter(id => !stack.known(id));
    const uncloned = Object.keys(p.nodes).filter(id => stack.known(id) && !stack.cloned(id));
    const ids = Object.keys(p.nodes).filter(id => stack.known(id) && stack.cloned(id));
    if (!ids.length) return { error: unknown.length === Object.keys(p.nodes).length ? `None of its apps are in this stack (${unknown.join(', ')}).` : `None of its apps are cloned here (${uncloned.join(', ')}).` };
    if (unknown.length) notes.push(`not in this stack: ${unknown.join(', ')}`);
    if (uncloned.length) notes.push(`not cloned: ${uncloned.map(name).join(', ')}`);
    const nodes = {};
    for (const id of ids) {
      const n = p.nodes[id], runs = stack.runIn(id), platforms = stack.platforms(id);
      const run = runs.includes(n.run) ? n.run : runs.includes('cli') ? 'cli' : runs[0];
      if (n.run && run !== n.run) notes.push(`${name(id)} cannot run in "${n.run}", using ${run}`);
      const node = { run };
      if (platforms.length && run === 'cli') {
        node.platform = platforms.includes(n.platform) ? n.platform : platforms[0];
        if (n.platform && node.platform !== n.platform) notes.push(`${name(id)} has no "${n.platform}" platform, using ${node.platform}`);
      }
      if (typeof n.branch === 'string' && n.branch.trim()) {
        node.branch = n.branch.trim();
        const branches = stack.branches(id);
        if (branches && !branches.includes(node.branch)) notes.push(`${name(id)} has no branch ${node.branch} in your clone (fetch it first)`);
      }
      if (typeof n.note === 'string' && n.note.trim()) node.note = n.note;
      if (n.tunnels === false) node.tunnels = false;
      if (n.queues === false) node.queues = false;
      nodes[id] = node;
    }
    const seen = new Set(), edges = [];
    let dropped = 0;
    for (const e of p.edges) {
      const key = `${e?.from}>${e?.to}`;
      if (!e || !Object.hasOwn(nodes, e.from) || !Object.hasOwn(nodes, e.to)) { if (e && stack.known(e.from) && stack.known(e.to)) dropped++; continue; }
      if (seen.has(key)) continue;
      if (!stack.canCall(e.from, e.to)) { notes.push(`${name(e.from)} does not call ${name(e.to)}, cable left out`); continue; }
      seen.add(key); edges.push({ from: e.from, to: e.to });
    }
    if (dropped) notes.push(`${dropped} ${dropped === 1 ? 'cable' : 'cables'} left out with their apps`);
    if (m.migratedFrom) notes.push(`updated from preset format ${m.migratedFrom}`);
    return { preset: { name: p.name.trim().slice(0, 80), version: VERSION, nodes, edges, ...(p.source && { source: p.source }) }, notes };
  }

  const api = { VERSION, MIGRATIONS, migrate, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KopplerPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
