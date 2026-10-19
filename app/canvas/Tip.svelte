<script lang="ts">
  // Every hint on the page, shown after a short wait instead of the browser's long one: an element's title is lifted
  // off while it is pointed at, so the browser shows none of its own, and put back when the pointer leaves.
  const WAIT = 350;
  let tip: HTMLElement | undefined = $state();
  let text = $state('');
  let held: { el: Element; title: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    clearTimeout(timer);
    if (held) held.el.setAttribute('title', held.title);
    held = null;
    if (tip?.matches(':popover-open')) tip.hidePopover();
  };
  const place = (el: Element) => {
    if (!tip) return;
    tip.showPopover();
    const at = el.getBoundingClientRect();
    const own = tip.getBoundingClientRect();
    const below = at.bottom + 6 + own.height <= innerHeight;
    const left = Math.min(Math.max(8, at.left + at.width / 2 - own.width / 2), innerWidth - own.width - 8);
    tip.style.left = `${String(left)}px`;
    tip.style.top = `${String(below ? at.bottom + 6 : at.top - 6 - own.height)}px`;
  };
  const over = (ev: Event) => {
    // Shown for keyboard focus too, never for a click's.
    if (ev.type === 'focusin' && !(ev.target instanceof Element && ev.target.matches(':focus-visible'))) return;
    const el = ev.target instanceof Element ? ev.target.closest('[title]') : null;
    if (!el || el === held?.el) return;
    const title = el.getAttribute('title') ?? '';
    hide();
    if (!title.trim()) return;
    held = { el, title };
    el.removeAttribute('title');
    text = title;
    timer = setTimeout(() => {
      place(el);
    }, WAIT);
  };
  const out = (ev: PointerEvent) => {
    if (held && !held.el.contains(ev.relatedTarget as Node | null)) hide();
  };
</script>

<svelte:document
  onpointerover={over}
  onpointerout={out}
  onfocusin={over}
  onfocusout={hide}
  onpointerdown={hide}
  onkeydown={hide}
/>
<svelte:window onscroll={hide} onblur={hide} />

<div bind:this={tip} class="tip" popover="manual" role="tooltip">{text}</div>

<style>
  .tip {
    position: fixed;
    inset: auto;
    max-width: 320px;
    margin: 0;
    padding: 6px 9px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    font: 500 12px/1.4 var(--sans);
    white-space: pre-line;
    pointer-events: none;
  }
</style>
