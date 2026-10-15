<script lang="ts">
  // Every drawn icon on the canvas: one library (Lucide), one stroke, whatever its size.
  import type { LucideProps } from '@lucide/svelte';
  import type { Component } from 'svelte';

  const {
    of: Of,
    size = 16,
    filled = false,
    label,
  }: { of: Component<LucideProps>; size?: number; filled?: boolean; label?: string } = $props();
</script>

<Of
  {size}
  strokeWidth={1.5}
  absoluteStrokeWidth
  fill={filled ? 'currentColor' : 'none'}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
/>
