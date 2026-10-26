// What every map's tools share: the drag tools, how a drag and a click behave, and presenting.
import Hand from '@lucide/svelte/icons/hand';
import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
import { SelectionMode } from '@xyflow/svelte';
import { board } from './board.svelte.ts';

export type Tool = 'select' | 'hand';
export const TOOLS = [
  ['select', 'Select (V): drag on the board to select an area', MousePointer2],
  ['hand', 'Hand (H): drag to move around. Or hold Space while dragging', Hand],
] as const;
export const FIT = { padding: 0.15, duration: 200, maxZoom: 1 };

/** How a map takes a drag and a click: an area is selected, or the map moves while panning. */
export const dragging = (panning: boolean) => ({
  elementsSelectable: !panning,
  multiSelectionKey: ['Shift', 'Meta', 'Control'],
  nodeDragThreshold: 4,
  nodeClickDistance: 4,
  panOnScroll: true,
  panOnScrollSpeed: 1,
  panOnDrag: panning ? true : [1, 2],
  selectionOnDrag: !panning,
  selectionMode: SelectionMode.Partial,
  minZoom: 0.2,
});

/** The drag tool, with Space held moving the map whichever tool is picked. */
export function toolState() {
  const state = $state<{ tool: Tool; space: boolean }>({ tool: 'select', space: false });
  return {
    get tool() {
      return state.tool;
    },
    set tool(tool: Tool) {
      state.tool = tool;
    },
    get panning() {
      return state.tool === 'hand' || state.space;
    },
    /** Space held moves the map; V and H pick the tool. */
    key(ev: KeyboardEvent) {
      if (ev.code === 'Space' && !(ev.target as Element).closest('input, select, textarea, button'))
        state.space = ev.type === 'keydown';
      if (ev.type !== 'keydown' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'v' || ev.key === 'V') state.tool = 'select';
      else if (ev.key === 'h' || ev.key === 'H') state.tool = 'hand';
    },
    blur() {
      state.space = false;
    },
  };
}

export const frame = () => new Promise(requestAnimationFrame);
// Full screen follows the board, one change at a time; the browser's word about a change made here is not news.
let syncing = false;
/** Shows the map alone, full screen, or brings the rest back; then fits it. */
export async function present(fit: () => Promise<void> | void): Promise<void> {
  board.present = !board.present;
  if (!syncing) {
    syncing = true;
    board.entering = true;
    while (board.present !== !!document.fullscreenElement) {
      const want = board.present;
      await (want ? document.documentElement.requestFullscreen() : document.exitFullscreen()).catch(() => undefined);
      // No full screen here (or refused): the board is shown alone all the same.
      if (want !== !!document.fullscreenElement) break;
    }
    board.entering = false;
    syncing = false;
  }
  await frame();
  await frame();
  await fit();
}
