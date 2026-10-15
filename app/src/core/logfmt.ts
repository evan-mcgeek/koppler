// Turns raw log lines into readable rows: time, level and message. Understands the JSON logs .NET apps write (Serilog
// compact and Microsoft's JSON console), cloudflared's "TIME LVL msg", Flutter's "flutter:" lines and build output.

export type Level = 'debug' | 'info' | 'warn' | 'error' | 'start' | 'koppler';
export interface Row {
  /** HH:MM:SS, or empty when the line carries no time. */
  time: string;
  level: Level;
  text: string;
  /** Lines that belong to the row: a stack trace, an exception. */
  detail: string;
  /** A compiler message. */
  build?: true;
  /** A run of compiler warnings folded into one row, with the warnings in `items`. */
  group?: 'build';
  items?: string[];
}

const LEVELS: Record<string, Level> = {
  verbose: 'debug',
  trace: 'debug',
  debug: 'debug',
  dbg: 'debug',
  information: 'info',
  info: 'info',
  inf: 'info',
  warning: 'warn',
  warn: 'warn',
  wrn: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'error',
  critical: 'error',
  crit: 'error',
};
const text = (value: unknown): string =>
  value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const level = (value: unknown): Level => LEVELS[text(value).toLowerCase()] ?? 'info';
function time(value: unknown): string {
  const clock = /T?(\d{2}:\d{2}:\d{2})/.exec(text(value))?.[1];
  if (!clock) return '';
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? clock : date.toTimeString().slice(0, 8);
}
// "{Name}", "{Name:l}" or "{@Name}" filled from the event's properties.
const fill = (template: unknown, props: Record<string, unknown>) =>
  text(template).replace(/\{[@$]?([\w.]+)(?:[,:][^}]*)?\}/g, (all, name: string) =>
    name in props ? text(props[name]) : all,
  );

/** A line that is one JSON object, as the structured loggers write it; null for anything else. */
function parseJsonLine(line: string): Row | null {
  if (!line.startsWith('{') || !line.endsWith('}')) return null;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof event !== 'object' || event === null) return null;
  const o = event as Record<string, unknown>;
  if ('@t' in o || '@m' in o || '@mt' in o)
    return {
      time: time(o['@t']),
      level: level(o['@l'] ?? 'Information'),
      text: text(o['@m'] ?? fill(o['@mt'], o)),
      detail: text(o['@x']),
    };
  if ('Timestamp' in o || 'MessageTemplate' in o || 'RenderedMessage' in o) {
    const props = (o['Properties'] ?? {}) as Record<string, unknown>;
    return {
      time: time(o['Timestamp']),
      level: level(o['Level']),
      text: text(o['RenderedMessage'] ?? fill(o['MessageTemplate'], props)),
      detail: text(o['Exception']),
    };
  }
  return null;
}

const TERMINAL_COLOURS = /\\?\^?\[\[?\d+m|\x1b\[[0-9;]*m/g;
// Each known shape of a text line, tried in order: the pattern, and the row its match makes.
const SHAPES: [RegExp, (m: RegExpExecArray) => Row][] = [
  [
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(INF|ERR|WRN|DBG)\s+(.*)$/,
    m => ({ time: time(m[1]), level: level(m[2]), text: m[3] ?? '', detail: '' }),
  ],
  [
    /^\[(\d{2}:\d{2}:\d{2})\s+(\w+)\]\s*(.*)$/,
    m => ({ time: m[1] ?? '', level: level(m[2]), text: m[3] ?? '', detail: '' }),
  ],
  // The line Koppler writes when it starts an app: the command.
  [
    /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2}) \$ (.*)$/,
    m => ({ time: m[1] ?? '', level: 'start', text: m[2] ?? '', detail: '' }),
  ],
  [
    /^flutter: (.*)$/s,
    m => ({
      time: '',
      level: /(^|\s)(Exception|Error)\b|\[31m/.test(m[1] ?? '') ? 'error' : 'info',
      text: (m[1] ?? '').replace(TERMINAL_COLOURS, ''),
      detail: '',
    }),
  ],
  [
    /^(.*?\.cs)\((\d+),\d+\): (warning|error) (\w+): (.*?)(?: \[[^\]]+\])?$/,
    m => ({
      time: '',
      level: m[3] === 'error' ? 'error' : 'warn',
      build: true,
      text: `${m[4] ?? ''} ${(m[1] ?? '').split('/').slice(-2).join('/')}:${m[2] ?? ''} ${m[5] ?? ''}`,
      detail: '',
    }),
  ],
  [/^koppler: (.*)$/s, m => ({ time: '', level: 'koppler', text: m[1] ?? '', detail: '' })],
];

export function parseLine(line: string): Row {
  const trimmed = line.trim();
  const fromJson = parseJsonLine(trimmed);
  if (fromJson) return fromJson;
  for (const [pattern, row] of SHAPES) {
    const match = pattern.exec(trimmed);
    if (match) return row(match);
  }
  const guessed = /\b(error|exception|fail(ed|ure)?|unhandled)\b/i.test(trimmed)
    ? 'error'
    : /\bwarn(ing)?\b/i.test(trimmed)
      ? 'warn'
      : 'info';
  return { time: '', level: guessed, text: trimmed, detail: '' };
}

const FLUTTER_TRACE = /^flutter: (#\d+\s|<asynchronous suspension>|\s*-- \S)/;
// Stack trace lines ("   at ...") and other indented lines belong to the row above.
const continues = (line: string, last: Row) =>
  (FLUTTER_TRACE.test(line) && last.level === 'error') || /^\s+(at |---|\.\.\.)/.test(line) || /^\s{2,}\S/.test(line);

export function parseLog(log: string | null | undefined): Row[] {
  const rows: Row[] = [];
  for (const line of (log ?? '').split('\n')) {
    if (!line.trim()) continue;
    const last = rows.at(-1);
    if (last && continues(line, last)) {
      last.detail += (last.detail ? '\n' : '') + line.replace(/^flutter: /, '').trim();
      continue;
    }
    const row = parseLine(line);
    // A run of compiler warnings is one row that says how many; the list stays one click away.
    if (row.build && row.level === 'warn' && last?.group === 'build' && last.items) {
      last.items.push(row.text);
      last.text = `${String(last.items.length)} build warnings`;
    } else if (row.build && row.level === 'warn') {
      rows.push({ time: '', level: 'warn', group: 'build', items: [row.text], text: '1 build warning', detail: '' });
    } else rows.push(row);
  }
  return rows;
}
