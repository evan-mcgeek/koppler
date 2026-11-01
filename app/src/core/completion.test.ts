import { describe, expect, it } from 'vitest';
import { commandsOf, completion, flagsOf, subcommandsOf } from './completion.ts';

describe('subcommandsOf', () => {
  it('reads the first word of each way to call a command, never a placeholder or a flag', () => {
    expect(subcommandsOf('[start] [--board "<name>"] [--no-open] [--new-address] | stop | restart')).toEqual([
      'start',
      'stop',
      'restart',
    ]);
    expect(subcommandsOf('set|list|remove|psql <app>[@<env>] [<NAME>] [--stdin]')).toEqual([
      'set',
      'list',
      'remove',
      'psql',
    ]);
    expect(subcommandsOf('[<GitHub link to a stack.json> | update | discard | pr]')).toEqual([
      'update',
      'discard',
      'pr',
    ]);
    expect(subcommandsOf('[--json] | session | done [<id>] | pin|unpin <id>')).toEqual([
      'session',
      'done',
      'pin',
      'unpin',
    ]);
    expect(subcommandsOf('[<stack>] [--boards] [--json]')).toEqual([]);
    expect(subcommandsOf('[app...] [--env <env>]')).toEqual([]);
    expect(subcommandsOf('<name...> | --all [--yes]')).toEqual([]);
  });
});

describe('commandsOf', () => {
  it('reads the subcommands of every form too', () => {
    const board = {
      name: 'board',
      about: '',
      args: 'new|edit "<name>" [--add <app,...>]',
      forms: [
        ['share "<name>"', 'x'] as [string, string],
        ['open <file or link> [--no-open]', 'y'] as [string, string],
      ],
    };
    expect(commandsOf(board)).toEqual(['new', 'edit', 'share', 'open']);
  });
});

describe('flagsOf', () => {
  it('gathers the flags of the arguments and of every form, once each', () => {
    const command = {
      name: 'canvas',
      about: '',
      args: '[--board "<name>"] [--no-open] | stop',
      forms: [['[--board "<name>"] [--no-open]', 'x'] as [string, string], ['--new-address', 'y'] as [string, string]],
    };
    expect(flagsOf(command)).toEqual(['--board', '--no-open', '--new-address']);
  });
});

describe('completion', () => {
  const commands = [
    { name: 'canvas', args: '[start] [--no-open] | stop', about: "start it; it's the canvas: open" },
    { name: 'guide', args: '', about: 'a page' },
  ];
  it('gives each shell the commands, their subcommands and flags, with quotes and colons kept safe', () => {
    const zsh = completion('zsh', commands);
    expect(zsh).toContain("'canvas:start it; it'\\''s the canvas\\: open'");
    expect(zsh).toContain('canvas) opts=(start stop --no-open) ;;');
    expect(zsh).not.toContain('guide)');
    expect(completion('bash', commands)).toContain('canvas) words="start stop --no-open" ;;');
    const fish = completion('fish', commands);
    expect(fish).toContain("complete -c koppler -n '__fish_seen_subcommand_from canvas' -a 'start stop'");
    expect(fish).toContain("complete -c koppler -n '__fish_seen_subcommand_from canvas' -l no-open");
  });
});
