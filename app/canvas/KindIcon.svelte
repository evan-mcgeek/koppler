<script lang="ts">
  import { iconOf } from './kind-icons.ts';

  const { kind, label }: { kind: string; label: string } = $props();
  const icon = $derived(iconOf(kind));
  const paths = $derived(icon.logo ? [icon.logo] : (icon.lines ?? []));
</script>

<!-- .NET is a wordmark: it sits on the name's baseline like text, where the symbol icons stay centred. -->
<svg
  class:wordmark={kind === 'dotnet'}
  viewBox="0 0 24 24"
  width="16"
  height="16"
  role="img"
  aria-label={label}
  fill={icon.logo ? 'currentColor' : 'none'}
  stroke={icon.logo ? 'none' : 'currentColor'}
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <title>{label}</title>
  {#each paths as d (d)}
    <path {d} />
  {/each}
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
  .wordmark {
    translate: 0 2px;
  }
</style>
