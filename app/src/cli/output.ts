// What every command shares when it talks to the person at the terminal: ending with a reason, asking, and tables.

/** Ends the command with one line saying why. A usage mistake exits 2, a failure 1, as most command line tools do. */
export function fail(message: string): never {
  console.error(`koppler: ${message}`);
  process.exit(message.startsWith('usage:') ? 2 : 1);
}

/** A y/N question in a terminal; without one (a script, an agent), only --yes says yes. */
export async function confirm(question: string, args: string[] = []): Promise<boolean> {
  if (args.includes('--yes') || args.includes('-y')) return true;
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline/promises');
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  const answer = (await terminal.question(`${question} [y/N] `)).trim().toLowerCase();
  terminal.close();
  return answer === 'y' || answer === 'yes';
}

/** Rows as columns, each as wide as its longest cell. */
export function table(rows: (string | number)[][]): void {
  const widths = (rows[0] ?? []).map((_, column) => Math.max(...rows.map(row => String(row[column] ?? '').length)));
  for (const row of rows)
    console.log(
      row
        .map((cell, column) => String(cell).padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd(),
    );
}

/** The arguments that are not options, nor the value of one of the `valued` options. */
export const positional = (args: string[], valued: string[] = []) =>
  args.filter((arg, at) => !arg.startsWith('-') && !valued.includes(args[at - 1] ?? ''));
export const flagValue = (args: string[], name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

/** The environment a command was asked for, the stack's first when none was; an unknown one ends the command. */
export function envOf(stack: { envs: string[] }, args: string[]): string {
  const env = flagValue(args, '--env') ?? stack.envs[0] ?? '';
  if (!stack.envs.includes(env)) fail(`unknown env ${env}; the stack has ${stack.envs.join(', ')}`);
  return env;
}
