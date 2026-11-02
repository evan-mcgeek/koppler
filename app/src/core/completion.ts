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

/** Each command's subcommands and flags, as one shell `case` row per command that has any. */
const cases = (commands: Completable[], row: (name: string, subs: string, flags: string) => string) =>
  commands.flatMap(one => {
    const [subs, flags] = [commandsOf(one), flagsOf(one)];
    return subs.length || flags.length ? [`    ${row(one.name, subs.join(' '), flags.join(' '))}`] : [];
  });

// Subcommands are offered only right after the command; its flags anywhere after it.
function zsh(commands: Completable[]): string {
  const described = commands.map(one => `    ${quoted(`${one.name}:${one.about.replaceAll(':', '\\:')}`)}`);
  return [
    '#compdef koppler',
    '_koppler() {',
    '  local -a cmds subs flags',
    '  cmds=(',
    ...described,
    '  )',
    '  if (( CURRENT == 2 )); then',
    "    _describe 'command' cmds",
    '    return',
    '  fi',
    '  case ${words[2]} in',
    ...cases(commands, (name, subs, flags) => `${name}) subs=(${subs}) flags=(${flags}) ;;`),
    '  esac',
    '  (( CURRENT == 3 )) && compadd -- $subs',
    '  compadd -- $flags',
    '  _files',
    '}',
    // A ~/.zshrc without the completion system on yet gets it here.
    '(( $+functions[compdef] )) || { autoload -U compinit && compinit }',
    'compdef _koppler koppler',
    '',
  ].join('\n');
}

function bash(commands: Completable[]): string {
  return [
    '_koppler() {',
    '  local cur=${COMP_WORDS[COMP_CWORD]} subs="" flags=""',
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    `    COMPREPLY=($(compgen -W "${commands.map(one => one.name).join(' ')} --help --version" -- "$cur"))`,
    '    return',
    '  fi',
    '  case ${COMP_WORDS[1]} in',
    ...cases(commands, (name, subs, flags) => `${name}) subs="${subs}" flags="${flags}" ;;`),
    '  esac',
    '  [ "$COMP_CWORD" -eq 2 ] || subs=""',
    '  COMPREPLY=($(compgen -W "$subs $flags" -- "$cur"))',
    '}',
    'complete -o default -F _koppler koppler',
    '',
  ].join('\n');
}

function fish(commands: Completable[]): string {
  return [
    // The command is the first word after koppler; `next` is right after it, before anything else is typed.
    'function __koppler_in; set -l w (commandline -opc); test (count $w) -ge 2; and test $w[2] = $argv[1]; end',
    'function __koppler_next; set -l w (commandline -opc); test (count $w) -eq 2; and test $w[2] = $argv[1]; end',
    ...commands.map(one => `complete -c koppler -n __fish_use_subcommand -a ${one.name} -d ${quoted(one.about)}`),
    ...commands.flatMap(one => {
      const subs = commandsOf(one);
      return [
        ...(subs.length ? [`complete -c koppler -n '__koppler_next ${one.name}' -a ${quoted(subs.join(' '))}`] : []),
        ...flagsOf(one).map(flag => `complete -c koppler -n '__koppler_in ${one.name}' -l ${flag.slice(2)}`),
      ];
    }),
    '',
  ].join('\n');
}

/** The script that teaches the shell koppler's commands. */
export function completion(shell: Shell, commands: Completable[]): string {
  return { zsh, bash, fish }[shell](commands);
}
