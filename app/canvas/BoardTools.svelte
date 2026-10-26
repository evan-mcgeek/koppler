<script lang="ts">
  // The tools under every map: drag tool, undo, arrange, fit, zoom and present, the same in Plan and Discover.
  import type { Snippet } from 'svelte';
  import { useSvelteFlow, useViewport } from '@xyflow/svelte';
  import Focus from '@lucide/svelte/icons/focus';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Icon from './Icon.svelte';
  import { board } from './board.svelte.ts';
  import { TOOLS, type Tool } from './tools.svelte.ts';
  import { undo } from './undo.svelte.ts';

  const map: {
    tool: Tool;
    ontool: (tool: Tool) => void;
    label: string;
    onarrange: () => void;
    onfit: () => void;
    onpresent: () => void;
    /** What only this map has, after the shared tools. */
    children?: Snippet;
  } = $props();
  const flow = useSvelteFlow();
  const viewport = useViewport();
  const zoomBy = (factor: number) => () => void flow.setZoom(flow.getZoom() * factor, { duration: 150 });
</script>

<div class="tools" role="toolbar" aria-label={map.label}>
  <div class="switch" role="radiogroup" aria-label="Dragging on the board">
    {#each TOOLS as [name, title, icon] (name)}
      <button
        class="tool"
        type="button"
        role="radio"
        aria-checked={map.tool === name}
        aria-label={title}
        {title}
        onclick={() => {
          map.ontool(name);
        }}
      >
        <Icon of={icon} size={16} />
      </button>
    {/each}
  </div>
  <button
    class="tool"
    type="button"
    aria-label="Undo"
    title="Undo (Ctrl+Z or Cmd+Z)"
    disabled={!undo.canUndo}
    onclick={() => {
      undo.undo();
    }}
  >
    <Icon of={Undo2} size={16} />
  </button>
  <button
    class="tool"
    type="button"
    aria-label="Redo"
    title="Redo (Shift+Ctrl+Z or Shift+Cmd+Z)"
    disabled={!undo.canRedo}
    onclick={() => {
      undo.redo();
    }}
  >
    <Icon of={Redo2} size={16} />
  </button>
  <button aria-label="Arrange" title="Arrange cards by who calls whom, callers on top" onclick={map.onarrange}
    ><Icon of={LayoutGrid} size={16} /></button
  >
  <button aria-label="Fit" title="Zoom to fit all apps (F)" onclick={map.onfit}><Icon of={Focus} size={16} /></button>
  <div class="zoom" role="group" aria-label="Zoom">
    <button aria-label="Zoom out" title="Zoom out" onclick={zoomBy(1 / 1.2)}><Icon of={Minus} size={16} /></button>
    <button class="percent" title="Reset to 100%" onclick={() => void flow.setZoom(1, { duration: 200 })}>
      {Math.round(viewport.current.zoom * 100)}%
    </button>
    <button aria-label="Zoom in" title="Zoom in" onclick={zoomBy(1.2)}><Icon of={Plus} size={16} /></button>
  </div>
  <button
    class="tool"
    type="button"
    aria-label={board.present ? 'Stop presenting' : 'Present'}
    title={board.present ? 'Stop presenting (Esc)' : 'Present: the board alone, full screen (P)'}
    aria-pressed={board.present}
    onclick={map.onpresent}
  >
    <Icon of={Maximize} size={16} />
  </button>
  {@render map.children?.()}
</div>

<style>
  /* Words printed on one strip, each with its key; each keeps its own edge, so a strip that wraps stays a clean grid. */
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    padding: 1px 0 0 1px;
  }
  .zoom,
  .switch {
    display: flex;
  }
  /* Canvas tools as icons in square cells, as in other canvas tools; a map's own word stays a word. */
  .tools :global(button) {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 32px;
    margin: -1px 0 0 -1px;
    padding: 0 8px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    font: 600 12px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .tools :global(button:hover:not(:disabled)) {
    background: color-mix(in oklab, var(--ink) 8%, var(--panel));
  }
  .tools :global(button:focus-visible) {
    position: relative;
    z-index: 1;
  }
  .tools .percent {
    width: 56px;
    font: 400 12px var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .tools .tool[aria-checked='true'],
  .tools .tool[aria-pressed='true'] {
    background: var(--line-strong);
    color: var(--ink);
  }
  .tools :global(button:disabled) {
    color: color-mix(in oklab, var(--ink-muted) 45%, transparent);
    cursor: default;
  }
</style>
