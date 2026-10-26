<script lang="ts">
  // The whole map at a glance; dragging in it moves the view, scrolling on it zooms. The same on every map.
  import { MiniMap } from '@xyflow/svelte';

  /** `strong`: the kind of card drawn brighter than the rest. */
  const { label, strong }: { label: string; strong: string } = $props();
</script>

<MiniMap
  position="bottom-right"
  pannable
  zoomable
  width={168}
  height={112}
  ariaLabel={label}
  nodeBorderRadius={0}
  nodeStrokeWidth={0}
  nodeColor={node => (node.type === strong ? 'var(--ink-muted)' : 'var(--line-strong)')}
  bgColor="var(--panel)"
  maskColor="color-mix(in oklab, var(--desk) 72%, transparent)"
  maskStrokeColor="var(--line)"
  maskStrokeWidth={1}
/>
