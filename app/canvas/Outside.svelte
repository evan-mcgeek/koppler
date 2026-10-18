<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import type { NodeProps } from '@xyflow/svelte';
  import InfraCard from './InfraCard.svelte';
  import { board, type OutsideNode } from './board.svelte.ts';
  import { dialogs } from './dialogs.svelte.ts';

  const { id, data, selected }: NodeProps<OutsideNode> = $props();
</script>

<InfraCard
  {id}
  kind="outside"
  name={data.name}
  tag="Outside"
  title={data.about.join('\n')}
  {selected}
  actions={[
    {
      label: `Settings for ${data.name}`,
      title: 'Settings: its addresses, and the apps it calls',
      icon: 'cog',
      run: () => void dialogs.settings?.open({ title: data.name, path: `apps.${id.slice(8)}` }),
    },
    {
      label: `Hide ${data.name}`,
      title: 'Take it off the board. Bring it back from the list of apps.',
      icon: X,
      run: () => {
        board.showOutside(id.slice(8), false);
      },
    },
  ]}
>
  <span class="where">{data.where}</span>
</InfraCard>

<style>
  .where {
    color: var(--ink-muted);
    font: 12px var(--mono);
  }
</style>
