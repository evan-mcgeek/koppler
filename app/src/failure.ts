// How a command ends early: the engine throws, and the entry file says why in one line and sets the exit code.

/** A command cannot go on. */
export class Failure extends Error {
  /** The exit code: 2 for a usage mistake, 3 when something is left for the agent, else 1. */
  readonly code: number;
  /** `message` empty when everything has been said already. */
  constructor(message: string, code = message.startsWith('usage:') ? 2 : 1) {
    super(message);
    this.code = code;
  }
}

/** Ends the command with one line saying why. A usage mistake exits 2, a failure 1, as most command line tools do. */
export function fail(message: string): never {
  throw new Failure(message);
}
