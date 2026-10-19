<script lang="ts">
  // Koppler's mark: a stem with two cables leaving it, each plugged into a socket.
  const { size = 24 }: { size?: number } = $props();
  const width = $derived(size <= 20 ? 8 : 6);
</script>

<svg class="mark" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
  <rect x="10" y="8" width="10" height="48" rx="5" fill="var(--ink)" />
  <path
    d="M20 32 C 34 32, 34 14, 47 14 M20 32 C 34 32, 34 50, 47 50"
    fill="none"
    stroke="var(--local)"
    stroke-width={width}
    stroke-linecap="round"
  />
  <circle cx="49" cy="14" r="7.5" fill="var(--ink)" />
  <circle cx="49" cy="50" r="7.5" fill="var(--ink)" />
  <circle cx="49" cy="14" r="2.5" fill="var(--panel)" />
  <circle cx="49" cy="50" r="2.5" fill="var(--panel)" />
</svg>

<style>
  .mark {
    display: block;
    flex: none;
  }
</style>
