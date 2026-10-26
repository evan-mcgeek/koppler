// A key the system takes over mid-press (a screenshot shortcut) never sends its key-up, and a map would keep
// selecting instead of moving cards: the mouse says which keys are really held.
const FLAGS = { Shift: 'shiftKey', Meta: 'metaKey', Control: 'ctrlKey', Alt: 'altKey' } as const;
type Key = keyof typeof FLAGS;

/** Tracks the modifier keys from key events, and lets them all go when the mouse says one is not held after all. */
export function heldKeys() {
  const held: Record<Key, boolean> = { Shift: false, Meta: false, Control: false, Alt: false };
  return {
    hold: (ev: KeyboardEvent) => {
      if (ev.key in FLAGS) held[ev.key as Key] = ev.type === 'keydown';
    },
    release: (ev: PointerEvent) => {
      const keys = Object.keys(FLAGS) as Key[];
      if (keys.every(key => !held[key] || ev[FLAGS[key]])) return;
      for (const key of keys) held[key] = false;
      // What the map library does when the window loses focus: every key it tracks is let go.
      window.dispatchEvent(new Event('blur'));
    },
  };
}
