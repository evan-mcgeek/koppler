<script lang="ts">
  // The gear that opens a thing's settings: the same one everywhere.
  import Settings from '@lucide/svelte/icons/settings';
  import Icon from './Icon.svelte';

  const { size = 14 }: { size?: number } = $props();
</script>

<Icon of={Settings} {size} />
