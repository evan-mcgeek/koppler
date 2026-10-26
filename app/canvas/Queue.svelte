<script lang="ts">
  import Icon from './Icon.svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import { useViewport } from '@xyflow/svelte';
  import InfraCard from './InfraCard.svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { board, FAR_ZOOM, type QueueNode } from './board.svelte.ts';
  import { dialogs } from './dialogs.svelte.ts';

  const { id, data, selected }: NodeProps<QueueNode> = $props();
  const env = $derived(board.env.toUpperCase());
  const viewport = useViewport();
  // Zoomed out the card is read for its place in the flow; the warning waits for a closer look.
  const far = $derived(viewport.current.zoom < FAR_ZOOM);
</script>

<InfraCard
  {id}
  kind="queue"
  name={data.name}
  tag={data.kind}
  status={data.local ? 'Runs on your Mac' : 'Uses the deployed queue'}
  title={data.about.join('\n')}
  {selected}
  actions={[
    {
      label: `Settings for ${data.name}`,
      title: "Settings: the queue's name and its queue on each environment",
      icon: 'cog',
      run: () => void dialogs.settings?.open({ title: data.name, path: `queues.${data.queue}` }),
    },
    {
      label: `Hide ${data.name}`,
      title: "Hide this queue: its apps use the deployed one. Bring it back from Queues on an app's card.",
      icon: X,
      run: () => {
        board.showQueues([data.queue], false);
      },
    },
  ]}
>
  {#snippet flag()}
    {#if data.shares && !far}<span
        class="warn"
        role="img"
        aria-label={data.shares}
        title={data.about.slice(1).join('\n')}><Icon of={TriangleAlert} size={13} /></span
      >{/if}
  {/snippet}
  <span class="label">Messages go to</span>
  <span class="seg nodrag" class:local={data.local} role="radiogroup" aria-label="Which {data.name} its apps use">
    <label title="The {env} queue">
      <input
        type="radio"
        name="queue-{data.queue}"
        checked={!data.local}
        onchange={() => {
          board.setQueue(data.queue, false);
        }}
      />Deployed
    </label>
    <label title="Koppler runs it on your Mac and points its apps at it">
      <input
        type="radio"
        name="queue-{data.queue}"
        checked={data.local}
        onchange={() => {
          board.setQueue(data.queue, true);
        }}
      />Local
    </label>
  </span>
</InfraCard>

<style>
  .seg label {
    flex: 1;
    padding: 6px 12px;
  }
  .warn {
    display: inline-grid;
    color: var(--warn);
  }
</style>
