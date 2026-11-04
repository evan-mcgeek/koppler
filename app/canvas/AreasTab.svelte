<script lang="ts">
  import Icon from './Icon.svelte';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Plus from '@lucide/svelte/icons/plus';
  // The stack's areas: each renamed in place, dragged into the order the board menu groups in, or removed from every
  // app and team board at once. A new one's id is made from its first name and never changes.
  import { tick } from 'svelte';
  import { areaId, areaUse, withoutArea } from '../src/core/areas.ts';
  import type { Ctx } from './settings.ts';

  const { stack, ctx }: { stack: unknown; ctx: Ctx } = $props();
  const areas = $derived((stack as { areas?: Record<string, { name?: string }> } | null)?.areas ?? {});
  const ids = $derived(Object.keys(areas));
  const nameOf = (id: string) => areas[id]?.name ?? id;
  const count = (n: number, one: string) => `${String(n)} ${one}${n === 1 ? '' : 's'}`;
  const joined = (names: string[]) =>
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}` : (names[0] ?? '');
  let adding = $state(false);
  let fresh = $state('');
  let freshInput = $state<HTMLInputElement>();
  let asking = $state<string | null>(null);
  let keep = $state<HTMLButtonElement>();
  let dragged = $state<string | null>(null);
  const use = $derived(asking ? areaUse(stack, asking) : null);

  /** A lock on the list holds its order and what can be added. */
  const listLocked = $derived(ctx.locked('areas'));
  /** The lock that keeps an area from being removed, in words: on it, or on an app or team board it would change. */
  const heldBy = (id: string): string | undefined => {
    if (listLocked) return 'the areas';
    if (ctx.locked(`areas.${id}`) || ctx.locked(`areas.${id}.name`)) return `the ${nameOf(id)} area`;
    const all = (stack ?? {}) as {
      apps?: Record<string, { name?: string; areas?: string[] }>;
      presets?: { name?: string; area?: string }[];
    };
    const app = Object.entries(all.apps ?? {}).find(
      ([key, one]) => one.areas?.includes(id) && ctx.locked(`apps.${key}.areas`),
    );
    if (app) return `${app[1].name ?? app[0]}'s areas`;
    const at = (all.presets ?? []).findIndex((one, n) => one.area === id && ctx.locked(`presets[${String(n)}].area`));
    return at < 0 ? undefined : `the area of ${all.presets?.[at]?.name ?? 'a team board'}`;
  };
  const order = (next: string[]) => void ctx.save('areas', Object.fromEntries(next.map(id => [id, areas[id]])));
  const move = (id: string, to: number) => {
    const rest = ids.filter(one => one !== id);
    order([...rest.slice(0, to), id, ...rest.slice(to)]);
  };
  const add = () => {
    const name = fresh.trim();
    adding = false;
    fresh = '';
    if (name) void ctx.save('areas', { ...areas, [areaId(name, ids)]: { name } });
  };
  const remove = async (id: string) => {
    const held = areaUse(stack, id);
    if (!held.apps.length && !held.boards.length) {
      void ctx.save('', withoutArea(stack, id));
      return;
    }
    asking = id;
    await tick();
    keep?.focus();
  };
</script>

<table class="area-table" aria-label="Areas">
  <thead>
    <tr
      ><th class="handle-col"></th><th>Name</th><th class="id">Id</th><th class="n">Apps</th><th class="n">Boards</th
      ><th class="end"></th></tr
    >
  </thead>
  <tbody>
    {#each ids as id, at (id)}
      {@const held = areaUse(stack, id)}
      {@const holder = heldBy(id)}
      <tr
        class:dragged={dragged === id}
        ondragover={ev => {
          if (dragged) ev.preventDefault();
        }}
        ondrop={ev => {
          ev.preventDefault();
          if (dragged && dragged !== id && !listLocked) move(dragged, at);
          dragged = null;
        }}
      >
        <td class="handle-col">
          <button
            class="handle"
            type="button"
            draggable={!listLocked}
            disabled={listLocked}
            aria-label="Move {nameOf(id)}"
            title={listLocked ? 'Locked: the areas' : 'Drag to reorder, or use the arrow keys'}
            ondragstart={ev => {
              dragged = id;
              ev.dataTransfer?.setData('text/plain', id);
            }}
            ondragend={() => (dragged = null)}
            onkeydown={ev => {
              const by = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
              if (!by) return;
              ev.preventDefault();
              move(id, Math.max(0, Math.min(ids.length - 1, at + by)));
              void tick().then(() => (ev.target as HTMLElement | null)?.focus());
            }}><Icon of={GripVertical} size={14} /></button
          >
        </td>
        <td>
          <input
            class="name"
            aria-label="Name"
            value={areas[id]?.name ?? ''}
            disabled={ctx.locked(`areas.${id}.name`)}
            title={ctx.locked(`areas.${id}.name`) ? 'Locked' : undefined}
            onchange={ev => void ctx.save(`areas.${id}.name`, ev.currentTarget.value.trim())}
          />
          {#if ctx.problem?.(`areas.${id}.name`)}<span class="error" role="alert"
              >{ctx.problem(`areas.${id}.name`)}</span
            >{/if}
        </td>
        <td class="mono">{id}</td>
        <td class="mono">{count(held.apps.length, 'app')}</td>
        <td class="mono">{count(held.boards.length, 'board')}</td>
        <td class="end">
          <button
            class="link"
            type="button"
            disabled={!!holder}
            title={holder ? `Locked: ${holder}` : undefined}
            onclick={() => void remove(id)}>Remove</button
          >
        </td>
      </tr>
    {/each}
    {#if adding}
      <tr>
        <td class="handle-col"></td>
        <td colspan="5">
          <input
            bind:this={freshInput}
            bind:value={fresh}
            class="name"
            aria-label="Name of the new area"
            placeholder="Payments"
            onkeydown={ev => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                add();
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                adding = false;
                fresh = '';
              }
            }}
            onblur={add}
          />
        </td>
      </tr>
    {/if}
  </tbody>
</table>
{#if !ids.length && !adding}
  <p class="empty">No areas yet. With none, everyone sees every app and board.</p>
{/if}
<div class="foot">
  <button
    class="link add"
    type="button"
    disabled={listLocked}
    title={listLocked ? 'Locked: the areas' : undefined}
    onclick={async () => {
      adding = true;
      await tick();
      freshInput?.focus();
    }}><Icon of={Plus} size={13} />Add area</button
  >
  {#if ids.length > 1}<span>Drag to reorder; the board menu groups in this order</span>{/if}
</div>
{#if asking && use}
  {@const name = nameOf(asking)}
  {@const worked = use.boards.filter(one => !use.byHand.includes(one))}
  <div class="ask" role="alertdialog" aria-labelledby="area-ask-title" aria-describedby="area-ask-what">
    <strong id="area-ask-title">Remove the {name} area?</strong>
    <div id="area-ask-what">
      {#if use.apps.length}<p>
          {count(use.apps.length, 'app')}
          {use.apps.length === 1 ? 'loses' : 'lose'} it: {use.apps.join(', ')}. Apps with no area left show in every
          area.
        </p>{/if}
      {#if worked.length}<p>
          {joined(worked)}
          {worked.length === 1 ? 'is' : 'are'} worked out from it and {worked.length === 1 ? 'moves' : 'move'} to the area
          most of {worked.length === 1 ? 'its' : 'their'} apps are in, or to No area.
        </p>{/if}
      {#if use.byHand.length}<p>
          {joined(use.byHand)}
          {use.byHand.length === 1 ? 'is' : 'are'} set to it by hand and {use.byHand.length === 1 ? 'goes' : 'go'} back to
          worked out.
        </p>{/if}
      <p>People who chose only {name} go back to all areas.</p>
    </div>
    <div class="ask-acts">
      <button bind:this={keep} type="button" onclick={() => (asking = null)}>Keep it</button>
      <button
        type="button"
        onclick={() => {
          const id = asking;
          asking = null;
          if (id) void ctx.save('', withoutArea(stack, id));
        }}>Remove {name}</button
      >
    </div>
  </div>
{/if}

<style>
  .area-table {
    width: calc(100% - 40px);
    margin: 0 20px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th.id {
    width: 96px;
  }
  th.n {
    width: 58px;
  }
  th.end {
    width: 56px;
  }
  th {
    padding: 10px 8px 6px;
    border-bottom: 1px solid var(--line);
    color: var(--ink-muted);
    font: 400 11px var(--sans);
    text-align: left;
  }
  td {
    padding: 6px 6px;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }
  .handle-col {
    width: 18px;
    padding: 0;
  }
  .handle {
    display: grid;
    place-items: center;
    width: 18px;
    height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: grab;
  }
  .handle:hover,
  .handle:focus-visible {
    color: var(--ink);
  }
  tr.dragged {
    opacity: 0.5;
  }
  .name {
    width: 100%;
    min-width: 0;
    height: 30px;
    box-sizing: border-box;
    padding: 0 8px;
    margin-left: -9px;
    border: 1px solid transparent;
    background: none;
    color: var(--ink);
    font: 600 14px var(--sans);
  }
  .name:hover:not(:disabled) {
    border-color: var(--line);
  }
  .name:focus {
    border-color: var(--ink);
    outline: none;
    background: var(--desk);
    font-weight: 400;
  }
  .name::placeholder {
    color: var(--muted);
    font-weight: 400;
  }
  .mono {
    overflow: hidden;
    color: var(--ink-muted);
    font: 11px var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .end {
    text-align: right;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 12px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .link:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .error {
    display: block;
    color: var(--bad);
    font-size: 12px;
  }
  .empty {
    color: var(--ink-muted);
    font-size: 13px;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 20px;
    padding: 10px 0 10px 8px;
    border-bottom: 1px solid var(--line);
    color: var(--ink-muted);
    font: 11px var(--sans);
  }
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .ask {
    display: grid;
    gap: 8px;
    margin: 16px 20px 0;
    padding: 16px;
    border: 1px solid var(--ink);
    background: var(--panel);
  }
  .ask strong {
    font: 600 16px var(--display);
  }
  .ask p {
    margin: 0 0 6px;
    color: var(--ink-muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .ask-acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .ask-acts button {
    padding: 7px 14px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .ask-acts button:hover {
    border-color: var(--ink);
  }
</style>
