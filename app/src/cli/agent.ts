// `koppler agent init`: links the skill into each agent on this Mac and registers `koppler mcp` with it.
// Another tool's config is only added to: a file that does not read as plain JSON is left alone, with what to add.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sh } from '../engine/processes.ts';
import { fail } from '../failure.ts';
import { APP, CODE } from '../paths.ts';
import { flagValue } from './output.ts';

const SKILL = 'koppler-run';
const USAGE = 'usage: koppler agent init [--agent claude,copilot,vscode,opencode] [--dry-run]';
interface Server {
  command: string;
  args: string[];
}
interface Agent {
  name: string;
  here: () => boolean;
  /** Where it reads skills from; null when another agent's folder already serves it. */
  skills: () => string | null;
  /** The skill comes with a plugin of its own. */
  plugin?: () => boolean;
  mcp: (server: Server, dry: boolean) => string;
}

const home = () => os.homedir();
const exists = (file: string) => fs.existsSync(file);
const vscodeDir = () =>
  process.platform === 'darwin'
    ? path.join(home(), 'Library', 'Application Support', 'Code', 'User')
    : path.join(home(), '.config', 'Code', 'User');
const onPath = (program: string) => !!sh('sh', ['-c', `command -v ${program}`]);

/** Adds one entry under a key of a JSON config file, creating the file when there is none. */
function addToJson(file: string, key: string, value: unknown, dry: boolean): string {
  let config: Record<string, unknown> = {};
  if (exists(file)) {
    try {
      const read: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!read || typeof read !== 'object' || Array.isArray(read)) throw new Error('not an object');
      config = read as Record<string, unknown>;
    } catch {
      return `left ${file} alone (not plain JSON); add under "${key}": "koppler": ${JSON.stringify(value)}`;
    }
  }
  const under = (config[key] ?? {}) as Record<string, unknown>;
  if (JSON.stringify(under['koppler']) === JSON.stringify(value)) return `MCP already in ${file}`;
  if (dry) return `would add koppler to ${file}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ ...config, [key]: { ...under, koppler: value } }, null, 2)}\n`);
  return `MCP added to ${file}`;
}

const AGENTS: Record<string, Agent> = {
  claude: {
    name: 'Claude Code',
    here: () => exists(path.join(home(), '.claude')) || onPath('claude'),
    skills: () => path.join(home(), '.claude', 'skills'),
    plugin: () => {
      try {
        return fs
          .readFileSync(path.join(home(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')
          .includes('"koppler@');
      } catch {
        return false;
      }
    },
    mcp: (server, dry) => {
      const add = ['mcp', 'add', '--scope', 'user', 'koppler', '--', server.command, ...server.args];
      if (!onPath('claude')) return `run: claude ${add.join(' ')}`;
      if (spawnSync('claude', ['mcp', 'get', 'koppler'], { stdio: 'ignore' }).status === 0) return 'MCP already added';
      if (dry) return `would run: claude ${add.join(' ')}`;
      const added = spawnSync('claude', add, { encoding: 'utf8' });
      return added.status === 0
        ? 'MCP added (claude mcp, user scope)'
        : `run: claude ${add.join(' ')} (${added.stderr.trim()})`;
    },
  },
  copilot: {
    name: 'GitHub Copilot CLI',
    here: () => exists(path.join(home(), '.copilot')) || onPath('copilot'),
    skills: () => path.join(home(), '.copilot', 'skills'),
    mcp: (server, dry) =>
      addToJson(
        path.join(home(), '.copilot', 'mcp-config.json'),
        'mcpServers',
        { type: 'local', ...server, tools: ['*'] },
        dry,
      ),
  },
  vscode: {
    name: 'VS Code',
    here: () => exists(vscodeDir()),
    // VS Code reads skills from ~/.copilot/skills, which Copilot's own entry links.
    skills: () => (AGENTS['copilot']?.here() ? null : path.join(home(), '.copilot', 'skills')),
    mcp: (server, dry) => addToJson(path.join(vscodeDir(), 'mcp.json'), 'servers', { type: 'stdio', ...server }, dry),
  },
  opencode: {
    name: 'OpenCode',
    here: () => exists(path.join(home(), '.config', 'opencode')) || onPath('opencode'),
    skills: () => path.join(home(), '.config', 'opencode', 'skills'),
    mcp: (server, dry) =>
      addToJson(
        path.join(home(), '.config', 'opencode', 'opencode.json'),
        'mcp',
        { type: 'local', command: [server.command, ...server.args], enabled: true },
        dry,
      ),
  },
};

/** The skill this Koppler carries: packed into the package, or in the clone it runs from. */
function skillSource(): string {
  const found = [path.join(APP, 'skills', SKILL), path.join(APP, '..', 'plugin', 'skills', SKILL)].find(dir =>
    exists(path.join(dir, 'SKILL.md')),
  );
  return found ?? fail(`the ${SKILL} skill is not in this Koppler (${APP})`);
}

/** Links the skill into a skills folder; a folder there that is not a link is the user's, and stays. */
function linkSkill(dir: string, source: string, dry: boolean): string {
  const at = path.join(dir, SKILL);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(at);
  } catch {
    // Nothing there yet.
  }
  if (stat && !stat.isSymbolicLink()) return `left ${at} alone (a folder of its own); remove it to link the skill`;
  if (stat && path.resolve(dir, fs.readlinkSync(at)) === source) return `skill already linked at ${at}`;
  if (dry) return `would link the skill at ${at}`;
  fs.mkdirSync(dir, { recursive: true });
  if (stat) fs.unlinkSync(at);
  fs.symlinkSync(source, at);
  return `skill linked at ${at}`;
}

/** `koppler agent init`: every agent found here, or the ones named, gets the skill and the MCP server. */
export function agentCommand(args: string[]): void {
  if (args[0] !== 'init') fail(USAGE);
  const named = flagValue(args, '--agent')?.split(',').filter(Boolean);
  for (const id of named ?? []) if (!Object.hasOwn(AGENTS, id)) fail(`no agent called ${id} (${USAGE})`);
  const dry = args.includes('--dry-run');
  const chosen = Object.entries(AGENTS).filter(([id, agent]) => (named ? named.includes(id) : agent.here()));
  if (!chosen.length)
    fail(`found none of Claude Code, GitHub Copilot CLI, VS Code or OpenCode here; name one with --agent (${USAGE})`);
  const source = fs.realpathSync(skillSource());
  const server: Server = onPath('koppler')
    ? { command: 'koppler', args: ['mcp'] }
    : { command: process.execPath, args: [path.join(CODE, 'koppler.mjs'), 'mcp'] };
  for (const [, agent] of chosen) {
    const skills = agent.skills();
    const skill = agent.plugin?.()
      ? 'skill comes with the koppler plugin'
      : skills
        ? linkSkill(skills, source, dry)
        : 'skill shared with GitHub Copilot CLI';
    console.log(`${agent.name}: ${skill}; ${agent.mcp(server, dry)}`);
  }
}
