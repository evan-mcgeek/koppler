// An app's commands from the stack (Seed, Migrate): started through the canvas server, which says how each ended.
import Database from '@lucide/svelte/icons/database';
import Download from '@lucide/svelte/icons/download';
import Play from '@lucide/svelte/icons/play';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Sprout from '@lucide/svelte/icons/sprout';
import SquareTerminal from '@lucide/svelte/icons/square-terminal';
import Trash from '@lucide/svelte/icons/trash';
import Upload from '@lucide/svelte/icons/upload';
import type { App } from '../src/core/stack.ts';
import { post } from './data.ts';
import { toasts } from './toast.svelte.ts';

export type AppCommand = NonNullable<App['commands']>[string];
/** What the dialog needs to ask before a command runs. */
export interface AppCommandAsk {
  app: string;
  appName: string;
  key: string;
  command: AppCommand;
}
export const COMMAND_ICON = {
  play: Play,
  database: Database,
  sprout: Sprout,
  refresh: RefreshCw,
  trash: Trash,
  terminal: SquareTerminal,
  upload: Upload,
  download: Download,
};

/** Starts it; the toast says it started, and the inbox says how it ended. */
export async function runCommand(ask: AppCommandAsk, args: Record<string, string> = {}): Promise<string | null> {
  const said = await post('app-command', { app: ask.app, command: ask.key, args });
  if ('error' in said) return said.error;
  toasts.show(`${ask.command.label} started on ${ask.appName}. The inbox says when it ends.`);
  return null;
}
