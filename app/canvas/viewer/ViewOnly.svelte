<script lang="ts">
  // An exported page: Discover to read, one flow at a time; the bar says whose, which flow, and where and when it was
  // made, and the reader picks the scheme.
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import type { Exported } from '../../src/core/export.ts';
  import { appearance, SCHEMES, type Scheme } from '../appearance.svelte.ts';
  import BarMenu from '../BarMenu.svelte';
  import { board } from '../board.svelte.ts';
  import Discover from '../Discover.svelte';
  import { discovered } from '../discover.svelte.ts';
  import Mark from '../Mark.svelte';

  const { data }: { data: Exported } = $props();
  const day = $derived(
    new Date(data.exported).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  );
  /** Another flow on screen, with nothing of the last one picked. */
  const show = (name: string) => {
    const next = data.boards.find(one => one.name === name);
    if (!next || next.name === board.name) return;
    discovered.step = null;
    discovered.phase = null;
    discovered.picked = [];
    discovered.last = null;
    discovered.thread = null;
    board.openBoard(next);
    board.discovering = true;
  };
</script>

<header>
  <span class="brand"><Mark size={22} /><span class="word">koppler</span></span>
  <span class="slash" aria-hidden="true">/</span>
  <span class="stack">{data.stack}</span>
  <span class="slash" aria-hidden="true">/</span>
  {#if data.boards.length > 1}
    <BarMenu
      label="Flows"
      name="flows"
      title="Another flow on this page"
      items={data.boards.map(one => ({
        label: one.name,
        run: () => {
          show(one.name);
        },
      }))}><span class="flow">{board.name}</span></BarMenu
    >
  {:else}
    <span class="flow">{board.name}</span>
  {/if}
  <span class="only">View only</span>
  <span class="when">{data.env ? `${data.env.toUpperCase()} · ` : ''}{day}</span>
  <span class="spacer"></span>
  <BarMenu
    label="Scheme"
    name="scheme"
    title="The colours this page is shown in, kept in this browser"
    items={Object.entries(SCHEMES).map(([id, one]) => ({
      label: one.name,
      about: one.note,
      run: () => {
        appearance.pickScheme(id as Scheme);
      },
    }))}><span class="words">{SCHEMES[appearance.now.scheme].name}</span></BarMenu
  >
  <span class="made">Made with koppler</span>
</header>
<main>
  <SvelteFlowProvider><Discover /></SvelteFlowProvider>
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    font: 400 14px var(--sans);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .word {
    font: 600 17px var(--sans);
  }
  .slash,
  .stack {
    color: var(--ink-muted);
  }
  .stack {
    font-weight: 500;
  }
  .flow {
    overflow: hidden;
    max-width: 420px;
    color: var(--ink);
    font: 600 14px var(--sans);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .only {
    padding: 2px 8px;
    border: 1px solid var(--line-strong);
    color: var(--ink);
    font: 600 12px var(--sans);
    white-space: nowrap;
  }
  .when,
  .made {
    color: var(--ink-muted);
    font-size: 13px;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  main {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }
  main > :global(*) {
    flex: 1;
  }
</style>
