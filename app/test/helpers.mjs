// Shared by the tests: ports the system says are free, and waiting for something instead of sleeping a guessed time.
import net from 'node:net';

const on = (port, host) => new Promise(resolve => { const s = net.createServer(); s.once('error', error => resolve(error.code === 'EADDRNOTAVAIL' ? port : null)); s.listen(port, host, () => { const got = s.address().port; s.close(() => resolve(got)); }); });
// Free on every local address: a program can hold a port on [::1] alone (as Dart's tools do), and Koppler sees it.
const free = async port => {
  const got = await on(port, '127.0.0.1');
  if (!got) return null;
  for (const host of ['::1', '0.0.0.0']) if ((await on(got, host)) !== got) return null;
  return got;
};
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
