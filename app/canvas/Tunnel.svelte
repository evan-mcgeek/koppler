<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Database from '@lucide/svelte/icons/database';
  import type { NodeProps } from '@xyflow/svelte';
  import InfraCard, { type CardAction } from './InfraCard.svelte';
  import { openTerminal } from './commands.ts';
  import { dialogs } from './dialogs.svelte.ts';
  import { board, type TunnelNode } from './board.svelte.ts';
  import { live } from './live.svelte.ts';

  const { id, data, selected }: NodeProps<TunnelNode> = $props();
  const on = $derived(live.tunnel(data.local.split(':').at(-1) ?? '', data.apps));
  const actions = $derived<CardAction[]>([
    ...(data.what.startsWith('Database')
      ? [
          {
            label: `Query the ${data.what}`,
            title: 'Open psql on it in a Terminal window, with the stored connection',
            icon: Database,
            run: () => void openTerminal(data.apps[0] ?? '', true),
          },
        ]
      : []),
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
  detail={data.local}
  detailWarn={data.moved}
  hasDot
  dot={on}
  dotTitle={on ? 'Tunnel is up' : on === false ? 'Nothing is listening on this port' : 'Not running'}
  title={[data.host, ...data.about].join('\n')}
  {selected}
  {actions}
>
  <span class="host">{data.host}</span>
</InfraCard>

<style>
  .host {
    display: block;
    max-width: 34ch;
  }
</style>
