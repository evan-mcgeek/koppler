// The log of every app on the board in one stream, in the order its lines arrived.

/** One app's log as read: its lines, and when each arrived (approximate when Koppler only read it). */
export interface Source {
  app: string;
  lines: string[];
  times: number[];
  approx?: boolean;
}
export interface Entry {
  app: string;
  /** When the line arrived, in ms since the epoch. */
  at: number;
  approx: boolean;
  line: string;
}

/**
 * A log's lines paired with their times, counted from the end: the times file has one per line the log has ended, so a
 * last line still being written takes the time before it, and older lines with no time left take the oldest.
 */
export function pairTimes(lines: string[], times: number[], ended: boolean): number[] {
  const done = ended ? lines.length : Math.max(0, lines.length - 1);
  const known = times.slice(-done);
  const oldest = known[0] ?? times.at(-1) ?? 0;
  const paired = [...Array<number>(done - known.length).fill(oldest), ...known];
  return ended || !lines.length ? paired : [...paired, times.at(-1) ?? oldest];
}

/** Every app's lines, oldest first; from `since`, the last `limit`. Lines of the same time keep each app's own order. */
export function mergeLogs(
  sources: Source[],
  { since = 0, limit = Infinity }: { since?: number; limit?: number } = {},
): Entry[] {
  const all = sources.flatMap((source, order) =>
    source.lines.map((line, index) => ({
      app: source.app,
      at: source.times[index] ?? source.times.at(-1) ?? 0,
      approx: !!source.approx,
      line,
      order,
      index,
    })),
  );
  return all
    .filter(entry => entry.at >= since)
    .sort((a, b) => a.at - b.at || a.order - b.order || a.index - b.index)
    .slice(Number.isFinite(limit) ? -limit : 0)
    .map(({ order: _order, index: _index, ...entry }) => entry);
}
