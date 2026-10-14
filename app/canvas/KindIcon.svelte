<script lang="ts">
  import Icon from './Icon.svelte';
  import { iconOf } from './kind-icons.ts';

  const { kind, label }: { kind: string; label: string } = $props();
  const icon = $derived(iconOf(kind));
</script>

<!-- .NET is a wordmark: it sits on the name's baseline like text, where the symbol icons stay centred. -->
{#if icon.logo}
  <svg
    class:wordmark={kind === 'dotnet'}
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="currentColor"
    role={label ? 'img' : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : 'true'}
  >
    {#if label}<title>{label}</title>{/if}
    <path d={icon.logo} />
  </svg>
{:else if icon.icon}
  <Icon of={icon.icon} size={16} {label} />
{/if}

<style>
  svg {
    flex: none;
    display: block;
  }
  .wordmark {
    translate: 0 2px;
  }
</style>
