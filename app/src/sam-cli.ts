// Running `sam build` for a runner: with the tools on this Mac, else in the runtime's own container.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

/** The environment SAM runs in: it finds Docker only through DOCKER_HOST, the endpoint of the active Docker context. */
export function samEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env['DOCKER_HOST']) {
    const inspect = ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'];
    const host = (spawnSync('docker', inspect, { encoding: 'utf8' }).stdout as string | null)?.trim();
    if (host) env['DOCKER_HOST'] = host;
  }
  return env;
}

/**
 * `sam build` with these arguments, cached first and in the runtime's container when that fails. Not blocking, so a
 * Stop during the build is heard at once; `started` gets each sam process. Gives its exit code, or null when it was
 * stopped by a signal: a build cut short is the end, not a reason to build another way.
 */
export async function samBuild(
  args: string[],
  options: { env: NodeJS.ProcessEnv; cwd: string },
  started: (child: ChildProcess) => void,
  say: (text: string) => void,
): Promise<number | null> {
  const build = (how: string) =>
    new Promise<number | null>(done => {
      const building = spawn('sam', ['build', ...args, how], { stdio: 'inherit', ...options });
      started(building);
      building.on('error', () => {
        done(1);
      });
      building.on('exit', (code, signal) => {
        done(signal ? null : code);
      });
    });
  const cached = await build('--cached');
  if (cached === 0 || cached === null) return cached;
  say('building in the runtime container instead');
  return build('--use-container');
}
