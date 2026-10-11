// Turns raw log lines into readable rows: time, level and message, from the JSON logs .NET apps write
// (Serilog compact and Microsoft's JSON console), cloudflared's "TIME LVL msg", Flutter's "flutter:" lines and build output.
(function (root) {
  const LEVELS = { verbose: 'debug', trace: 'debug', debug: 'debug', dbg: 'debug', information: 'info', info: 'info', inf: 'info',
    warning: 'warn', warn: 'warn', wrn: 'warn', error: 'error', err: 'error', fatal: 'error', critical: 'error', crit: 'error' };
  const level = v => LEVELS[String(v ?? '').toLowerCase()] ?? 'info';
  const time = v => { const m = String(v ?? '').match(/T?(\d{2}:\d{2}:\d{2})/); if (!m) return ''; const d = new Date(v); return isNaN(d) ? m[1] : d.toTimeString().slice(0, 8); };
  const show = v => v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // "{Name}", "{Name:l}" or "{@Name}" filled from the event's properties.
  const fill = (template, props) => String(template).replace(/\{[@$]?([\w.]+)(?:[,:][^}]*)?\}/g, (all, name) => name in props ? show(props[name]) : all);

  function parseLine(line) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      let o; try { o = JSON.parse(t); } catch { o = null; }
      if (o && typeof o === 'object') {
        if ('@t' in o || '@m' in o || '@mt' in o) {
          return { time: time(o['@t']), level: level(o['@l'] ?? 'Information'), text: o['@m'] ?? fill(o['@mt'] ?? '', o), detail: o['@x'] ?? '' };
        }
        if ('Timestamp' in o || 'MessageTemplate' in o || 'RenderedMessage' in o) {
          const props = o.Properties ?? {};
          return { time: time(o.Timestamp), level: level(o.Level), text: o.RenderedMessage ?? fill(o.MessageTemplate ?? '', props), detail: o.Exception ?? '' };
        }
      }
    }
    let m = t.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(INF|ERR|WRN|DBG)\s+(.*)$/);
    if (m) return { time: time(m[1]), level: level(m[2]), text: m[3], detail: '' };
    m = t.match(/^\[(\d{2}:\d{2}:\d{2})\s+(\w+)\]\s*(.*)$/);
    if (m) return { time: m[1], level: level(m[2]), text: m[3], detail: '' };
    m = t.match(/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2}) \$ (.*)$/);
    if (m) return { time: m[1], level: 'start', text: m[2], detail: '' };
    m = t.match(/^flutter: (.*)$/s);
    if (m) return { time: '', level: /(^|\s)(Exception|Error)\b|\[31m/.test(m[1]) ? 'error' : 'info', text: m[1].replace(/\\?\^?\[\[?\d+m|\x1b\[[0-9;]*m/g, ''), detail: '' };
    m = t.match(/^(.*?\.cs)\((\d+),\d+\): (warning|error) (\w+): (.*?)(?: \[[^\]]+\])?$/);
    if (m) return { time: '', level: m[3] === 'error' ? 'error' : 'warn', build: true, text: `${m[4]} ${m[1].split('/').slice(-2).join('/')}:${m[2]} ${m[5]}`, detail: '' };
    if (/^koppler: /.test(t)) return { time: '', level: 'koppler', text: t.slice(9), detail: '' };
    return { time: '', level: /\b(error|exception|fail(ed|ure)?|unhandled)\b/i.test(t) ? 'error' : /\bwarn(ing)?\b/i.test(t) ? 'warn' : 'info', text: t, detail: '' };
  }

  // Stack trace lines ("   at ...") and other indented lines belong to the row above.
  function parseLog(text) {
    const rows = [];
    for (const line of String(text ?? '').split('\n')) {
      if (!line.trim()) continue;
      const flutterTrace = /^flutter: (#\d+\s|<asynchronous suspension>|\s*-- \S)/.test(line) && rows.at(-1)?.level === 'error';
      if (rows.length && (flutterTrace || /^\s+(at |---|\.\.\.)/.test(line) || /^\s{2,}\S/.test(line))) { rows.at(-1).detail += (rows.at(-1).detail ? '\n' : '') + line.replace(/^flutter: /, '').trim(); continue; }
      const row = parseLine(line), last = rows.at(-1);
      // A run of compiler warnings is one row that says how many; the list stays one click away.
      if (row.build && row.level === 'warn' && last?.group === 'build') { last.items.push(row.text); last.text = `${last.items.length} build warnings`; continue; }
      if (row.build && row.level === 'warn') { rows.push({ time: '', level: 'warn', group: 'build', items: [row.text], text: '1 build warning', detail: '' }); continue; }
      rows.push(row);
    }
    return rows;
  }
  const api = { parseLine, parseLog };
  if (typeof module !== 'undefined') module.exports = api; else root.KopplerLog = api;
})(this);
