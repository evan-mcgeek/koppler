// Loaded before anything else by every test run: HOME and every Koppler folder point into a temp folder of its own,
// so no test, however it is filtered, reads or writes the user's real state or config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.KOPPLER_TEST_SANDBOX) {
  const realHome = os.homedir();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-test-'));
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(home);
  // Browsers stay where Playwright installed them under the real home.
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(realHome, process.platform === 'darwin' ? 'Library/Caches' : '.cache', 'ms-playwright');
  Object.assign(process.env, {
    KOPPLER_TEST_SANDBOX: sandbox,
    HOME: home,
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    KOPPLER_STATE: path.join(sandbox, 'state'),
    KOPPLER_CONFIG_DIR: path.join(sandbox, 'config'),
  });
  // Run state and logs follow KOPPLER_STATE, as a test that sets only that expects.
  for (const name of ['KOPPLER_TEMP', 'KOPPLER_LOGS', 'CLAUDE_CODE_SESSION_ID']) delete process.env[name];
  process.on('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));
}
