// Shared by the tests: ports the system says are free, and waiting for something instead of sleeping a guessed time.
import net from 'node:net';

const free = port => new Promise(resolve => { const s = net.createServer(); s.once('error', () => resolve(null)); s.listen(port, '127.0.0.1', () => { const got = s.address().port; s.close(() => resolve(got)); }); });
// `count` free ports; with `roomAfter`, each also has that many free ports straight after it.
export async function freePorts(count, { roomAfter = 0 } = {}) {
  const ports = [];
  while (ports.length < count) {
    const port = await free(0);
    const room = await Promise.all(Array.from({ length: roomAfter }, (_, i) => free(port + i + 1)));
    if (port && !ports.includes(port) && room.every(Boolean) && port + roomAfter < 65536) ports.push(port);
  }
  return ports;
}
// Resolves once `done()` is true; fails with what was waited for.
export async function until(what, done, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (await done()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`${what} did not happen within ${ms / 1000}s`);
}
