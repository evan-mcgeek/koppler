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
  detail={data.kind}
  title={data.about.join('\n')}
  {selected}
  active={data.local}
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
  {#if data.upstream}
    <span class="stays">Stays deployed</span>
  {:else}
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
      <label
        aria-disabled={!data.can}
        title={data.can
          ? 'Koppler runs it on your Mac and points its apps at it'
          : `Koppler cannot run a ${data.kind} queue locally yet`}
      >
        <input
          type="radio"
          name="queue-{data.queue}"
          checked={data.local}
          disabled={!data.can}
          onchange={() => {
            board.setQueue(data.queue, true);
          }}
        />Local
      </label>
    </span>
  {/if}
</InfraCard>

<style>
  .stays {
    color: var(--muted);
    font: 500 12px var(--sans);
  }
  .seg {
    display: inline-flex;
    font-family: var(--sans);
  }
  .seg label {
    padding: 2px 10px;
    font-size: 12px;
  }
  .seg.local label:has(input:checked) {
    background: var(--msg);
    color: var(--on-accent);
  }
  .seg label[aria-disabled='true'] input {
    opacity: 0;
  }
  .seg label:has(input:focus-visible) {
    outline: 2px solid var(--cable);
    outline-offset: 1px;
  }
  .warn {
    display: inline-grid;
    color: var(--warn);
  }
</style>
