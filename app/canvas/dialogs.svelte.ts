import type { AppCommandAsk } from './commands.ts';
// The page's few dialogs, mounted once and opened from wherever they are asked for.
export const dialogs = $state<{
  setup?: { open: (pane?: 'start' | 'join' | 'new') => void };
  repos?: { open: () => Promise<void> };
  outside?: { open: () => void };
  settings?: { open: (what: { title: string; path: string }) => Promise<void> };
  checklist?: { open: () => Promise<void> };
  findings?: { open: (how?: { afterAdding?: boolean }) => Promise<void> };
  command?: { open: (what: AppCommandAsk) => void };
}>({});
