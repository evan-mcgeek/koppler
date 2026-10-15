// What `koppler doctor --approve` records, for tests whose stacks start apps with their own commands.
import fs from 'node:fs';
import path from 'node:path';
import { fingerprint, stackCommands } from '../dist/engine/checks.js';

export function allowStack(configDir, registry) {
  fs.writeFileSync(path.join(configDir, 'approved-checks.json'), JSON.stringify({ [registry.source ?? '']: fingerprint(stackCommands(registry)) }));
}
