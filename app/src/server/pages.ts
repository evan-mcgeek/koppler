// The canvas pages open in a browser: each holds a stream open, so `koppler canvas` can show one instead of opening another.
import type { ServerResponse } from 'node:http';

const pages = new Set<ServerResponse>();

export function joinPage(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  res.write(': open\n\n');
  pages.add(res);
  res.on('close', () => pages.delete(res));
}

/** Hands every open page what to show (`#board=<name>`, `#pick` or nothing); how many pages there were. */
export function showPages(hash: string): number {
  for (const page of pages) page.write(`data: ${JSON.stringify({ hash })}\n\n`);
  return pages.size;
}
