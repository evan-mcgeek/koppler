/* global document */
// The appearance chosen in Settings, set before the page draws: its scheme, and the local and deployed colours picked by
// hand. A file of its own: the page allows no inline script. appearance.svelte.ts checks the same values again.
try {
  const kept = JSON.parse(localStorage.getItem('koppler-appearance') || '{}');
  const root = document.documentElement;
  if (['lime', 'signal', 'scope', 'sodium'].includes(kept.scheme)) root.dataset.scheme = kept.scheme;
  for (const [name, value] of [
    ['--local', kept.local],
    ['--deployed', kept.deployed],
  ])
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value)) root.style.setProperty(name, value);
} catch {
  // Not kept in this browser: Mono is used.
}
