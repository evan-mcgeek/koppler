/* global document */
// Applies the saved appearance before the page draws, as appearance.svelte.ts does after (no inline script allowed).
try {
  const kept = JSON.parse(localStorage.getItem('koppler-appearance') || '{}');
  const root = document.documentElement;
  const light = ['paper', 'blueprint', 'workshop'].includes(kept.scheme);
  if (light || ['lime', 'signal', 'scope', 'sodium'].includes(kept.scheme)) root.dataset.scheme = kept.scheme;
  // A green local cable would read as running: the running light then takes the ink colour (as appearance.svelte.ts).
  const greens = ['#c8f03c', '#52f29a', '#1a6e2e'].includes(kept.local) && !['lime', 'scope'].includes(kept.scheme);
  for (const [name, value] of [
    ['--local', kept.local],
    ['--deployed', kept.deployed],
    ['--live', greens ? (light ? '#141414' : '#ffffff') : undefined],
  ])
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value)) root.style.setProperty(name, value);
} catch {
  // Not kept in this browser: Mono is used.
}
