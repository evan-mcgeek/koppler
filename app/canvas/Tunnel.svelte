<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import type { NodeProps } from '@xyflow/svelte';
  import InfraCard, { type CardAction } from './InfraCard.svelte';
  import { dialogs } from './dialogs.svelte.ts';
  import { board, type TunnelNode } from './board.svelte.ts';
  import { live } from './live.svelte.ts';
  import { post } from './data.ts';
  import { toasts } from './toast.svelte.ts';

  const { id, data, selected }: NodeProps<TunnelNode> = $props();
  const port = $derived(data.local.split(':').at(-1) ?? '');
  const on = $derived(live.tunnel(port, data.apps));
  const restart = async () => {
    const done = await post<{ ok: true }>('restart-tunnel', { port: Number(port) });
    if ('error' in done) toasts.show(done.error, 'warning');
    else toasts.show(`The ${data.what} tunnel started again.`);
  };
  const actions = $derived<CardAction[]>([
    {
      label: `Settings for the ${data.what} tunnel`,
      title: 'Settings: the host, its port and how it is opened',
      icon: 'cog',
      run: () => void dialogs.settings?.open({ title: `${data.what} tunnel`, path: data.settings }),
    },
    {
      label: 'Run without this tunnel',
      title:
        "Turn it off: the tunnel is not opened, so calls to it fail. Turn Tunnels back on on the app's card to bring it back.",
      icon: X,
      run: () => {
        board.hideTunnel(id);
      },
    },
  ]);
</script>

<InfraCard
  {id}
  kind="tunnel"
  name={data.what}
  tag="Tunnel"
  hasDot
  dot={on}
  dotTitle={on ? 'Tunnel is up' : on === false ? 'Nothing is listening on this port' : 'Not running'}
  status={on ? 'Connected' : on === false ? 'Nothing is listening' : 'Not running'}
  title={[data.host, ...data.about].join('\n')}
  {selected}
  {actions}
  act={on === undefined
    ? undefined
    : {
        label: `Restart the ${data.what} tunnel`,
        word: 'Reconnect',
        title: 'Close the tunnel and open it again, for when calls through it hang or fail',
        icon: RefreshCw,
        run: () => void restart(),
      }}
>
  <span class="label">Local port</span>
  <span class="well" class:moved={data.moved}>{data.local}</span>
  <span class="label">Goes to</span>
  <span class="host">{data.host}</span>
</InfraCard>

<style>
  .well {
    padding: 6px 8px;
    border: 1px solid var(--line);
    background: var(--desk);
    font: 12px var(--mono);
  }
  .well.moved {
    border-color: var(--warn);
    color: var(--warn);
  }
  .host {
    display: block;
    max-width: 34ch;
    color: var(--ink-muted);
    font: 12px var(--mono);
  }
</style>
