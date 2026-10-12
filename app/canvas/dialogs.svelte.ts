// The page's few dialogs, mounted once and opened from wherever they are asked for.
export const dialogs = $state<{
  setup?: { open: (pane?: 'start' | 'join' | 'new') => void };
  repos?: { open: () => Promise<void> };
  findings?: { open: (how?: { afterAdding?: boolean }) => Promise<void> };
}>({});
