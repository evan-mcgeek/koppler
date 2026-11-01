// Shell completion for koppler, read from the same table `koppler --help` is: commands, their subcommands and flags.

export interface Completable {
  name: string;
  args: string;
  about: string;
  forms?: [string, string][];
}
export type Shell = 'zsh' | 'bash' | 'fish';
export const SHELLS: readonly Shell[] = ['zsh', 'bash', 'fish'];

const WORD = /^[a-z][a-z-]*$/;

/** The words a command takes first, as `canvas stop` or `board new`: the first word of each way to call it. */
export function subcommandsOf(args: string): string[] {
  const whole = args.trim();
  const inside = /^\[[^[\]]*\]$/.test(whole) ? whole.slice(1, -1) : whole;
  const words = inside
    .split(/\s+\|\s+/)
    .map(way => way.trim().split(/\s+/)[0] ?? '')
    .flatMap(first => first.replace(/^\[|\]$/g, '').split('|'))
    .filter(word => WORD.test(word));
  return [...new Set(words)];
}

/** A command's subcommands, from its arguments and from each of its forms. */
export const commandsOf = (command: Completable): string[] => [
  ...new Set([command.args, ...(command.forms ?? []).map(([form]) => form)].flatMap(subcommandsOf)),
];

/** Every flag a command names, in its arguments or in any of its forms. */
export function flagsOf(command: Completable): string[] {
  const text = [command.args, ...(command.forms ?? []).map(([form]) => form)].join(' ');
  return [...new Set(text.match(/--[a-z][a-z-]*/g) ?? [])];
}

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

function zsh(commands: Completable[]): string {
  const described = commands.map(one => `    ${quoted(`${one.name}:${one.about.replaceAll(':', '\\:')}`)}`);
  const cases = commands.flatMap(one => {
    const words = [...commandsOf(one), ...flagsOf(one)];
    return words.length ? [`    ${one.name}) opts=(${words.join(' ')}) ;;`] : [];
  });
  return [
    '#compdef koppler',
    '_koppler() {',
    '  local -a cmds opts',
    '  cmds=(',
    ...described,
    '  )',
    '  if (( CURRENT == 2 )); then',
    "    _describe 'command' cmds",
    '    return',
    '  fi',
    '  case ${words[2]} in',
    ...cases,
    '  esac',
    '  compadd -- $opts',
    '  _files',
    '}',
    'compdef _koppler koppler',
    '',
  ].join('\n');
}

function bash(commands: Completable[]): string {
  const cases = commands.flatMap(one => {
    const words = [...commandsOf(one), ...flagsOf(one)];
    return words.length ? [`    ${one.name}) words="${words.join(' ')}" ;;`] : [];
  });
  return [
    '_koppler() {',
    '  local cur=${COMP_WORDS[COMP_CWORD]} words=""',
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    `    COMPREPLY=($(compgen -W "${commands.map(one => one.name).join(' ')} --help --version" -- "$cur"))`,
    '    return',
    '  fi',
    '  case ${COMP_WORDS[1]} in',
    ...cases,
    '  esac',
    '  COMPREPLY=($(compgen -W "$words" -- "$cur"))',
    '}',
    'complete -o default -F _koppler koppler',
    '',
  ].join('\n');
}

function fish(commands: Completable[]): string {
  return [
    ...commands.map(one => `complete -c koppler -n __fish_use_subcommand -a ${one.name} -d ${quoted(one.about)}`),
    ...commands.flatMap(one => {
      const when = `-n '__fish_seen_subcommand_from ${one.name}'`;
      const subs = commandsOf(one);
      return [
        ...(subs.length ? [`complete -c koppler ${when} -a ${quoted(subs.join(' '))}`] : []),
        ...flagsOf(one).map(flag => `complete -c koppler ${when} -l ${flag.slice(2)}`),
      ];
    }),
    '',
  ].join('\n');
}

/** The script that teaches the shell koppler's commands. */
export function completion(shell: Shell, commands: Completable[]): string {
  return { zsh, bash, fish }[shell](commands);
}
