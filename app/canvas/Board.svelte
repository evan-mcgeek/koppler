<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    getViewportForBounds,
    MiniMap,
    SelectionMode,
    Panel,
    SvelteFlow,
    useSvelteFlow,
    useViewport,
    ViewportPortal,
  } from '@xyflow/svelte';
  import type { Point, Side } from '../src/core/arrange.ts';
  import { cablePath, sidePoint, SIDES, throughPath, type Box } from '../src/core/cables.ts';
  import { untrack } from 'svelte';
  import Hand from '@lucide/svelte/icons/hand';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Focus from '@lucide/svelte/icons/focus';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Minus from '@lucide/svelte/icons/minus';
  import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
  import Plus from '@lucide/svelte/icons/plus';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Icon from './Icon.svelte';
  import { appearance, isLight } from './appearance.svelte.ts';
  import AppCard from './AppCard.svelte';
  import Cable from './Cable.svelte';
  import Database from './Database.svelte';
  import Queue from './Queue.svelte';
  import Tunnel from './Tunnel.svelte';
  import { board, CARD_PANEL, FAR_ZOOM, type CardNode, type InfraNode } from './board.svelte.ts';
  import { wiring } from './wiring.svelte.ts';
  import { undo } from './undo.svelte.ts';
  import { ago, openBoard } from './boards.ts';
  import { live } from './live.svelte.ts';
  import { heldKeys } from './held-keys.ts';
  import { probes, type Job, type Probe } from './probes.svelte.ts';
  import { runs } from './run.svelte.ts';

  const flow = useSvelteFlow();
  board.toFlow = at => flow.screenToFlowPosition(at, { snapToGrid: false });
  board.zoom = () => flow.getZoom();
  const viewport = useViewport();
  // The card panel takes its room from the board's right. Opened on a card it would cover, picked with a click, the
  // board slides left as far, and back when it closes; otherwise, and for a card moved by hand, the board stays. The
  // view saved is the one without the slide.
  let shift = 0;
  let pressed: { x: number; y: number } | null = null;
  const panelId = $derived(board.panelCard?.id);
  const slide = (moved: boolean) => {
    const { x, y, zoom } = flow.getViewport();
    const id = board.panelCard?.id;
    if (!id) {
      if (shift) void flow.setViewport({ x: x + shift, y, zoom });
      shift = 0;
      return;
    }
    if (shift || moved) return;
    const box = area?.querySelector(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
    if (!box || box.right <= board.area().right) return;
    void flow.setViewport({ x: x - CARD_PANEL, y, zoom });
    shift = CARD_PANEL;
  };
  $effect(() => {
    if (panelId === undefined && !shift) return;
    const down = pressed;
    // After the press that picked the card, and once the panel takes its room: slid out from under the pointer, the
    // release would land on the empty board and drop the pick.
    if (down)
      window.addEventListener(
        'pointerup',
        ev =>
          setTimeout(() => {
            slide(Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4);
          }),
        { once: true },
      );
    else
      setTimeout(() => {
        slide(false);
      });
  });
  let area: HTMLElement | undefined = $state();
  board.area = () => area?.getBoundingClientRect() ?? new DOMRect();
  // Brings a card to the middle of the board, at the zoom the board is at, and picks it.
  board.show = id => {
    board.pick(id);
    const zoom = flow.getZoom();
    void flow.fitView({ nodes: [{ id }], minZoom: zoom, maxZoom: zoom, duration: 200 });
  };
  // Fitting never blows a small board up past its real size.
  const FIT = { padding: 0.15, duration: 200, maxZoom: 1 };
  const CARD = { w: 260, h: 160 };
  // Not the library's zoomIn and zoomOut: taken here, before its board exists, they stay tied to an empty one.
  const zoomBy = (factor: number) => () => void flow.setZoom(flow.getZoom() * factor, { duration: 150 });

  /** For an empty board: the six boards opened last, then the rest in the order they are kept. */
  const lately = $derived(
    [...board.team.map(preset => ({ preset, team: true })), ...board.own.map(preset => ({ preset, team: false }))]
      .map((one, index) => ({
        ...one,
        index,
        at: board.recent.find(opened => opened.name === one.preset.name)?.at ?? '',
      }))
      .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at > b.at ? -1 : 1))
      .slice(0, 6),
  );
  /** Where a socket was pressed, to tell a click in place from a slide. */
  let pressedAt = { x: 0, y: 0 };
  // Whenever what runs or what is cabled changes, cables whose apps both answer are tested.
  $effect(() => {
    probes.follow(jobs);
  });
  const draft = $derived.by(() => {
    const drawn = wiring.draft;
    if (!drawn) return '';
    return drawn.points.length
      ? throughPath(drawn.a, drawn.side, drawn.b, drawn.bSide, drawn.points)
      : cablePath(drawn.a, drawn.side, drawn.b, drawn.bSide);
  });
  /** What a drag on the empty board does: select an area, or move the board. Space held moves it either way. */
  let tool = $state<'select' | 'hand'>('select');
  let spaceHeld = $state(false);
  /** Moving the board: cards are neither picked, let go of nor moved, so the pick stays as it was. */
  const panning = $derived(tool === 'hand' || spaceHeld);
  const space = (ev: KeyboardEvent) => {
    if (ev.code !== 'Space' || (ev.target as Element).closest('input, select, textarea, button')) return;
    spaceHeld = ev.type === 'keydown';
  };
  const TOOLS = [
    ['select', 'Select (V): drag on the board to select an area', MousePointer2],
    ['hand', 'Hand (H): drag to move around. Or hold Space while dragging', Hand],
  ] as const;
  const { hold, release } = heldKeys();
  const shortcut = (ev: KeyboardEvent) => {
    if (ev.altKey || (ev.target as Element).closest('input, select, textarea')) return;
    // A dialog or a menu over the board has the keyboard to itself.
    if (document.querySelector('dialog[open], :popover-open')) return;
    const key = ev.key.toLowerCase();
    if (ev.metaKey || ev.ctrlKey) {
      if (key === 'a' && !board.live) {
        ev.preventDefault();
        board.selectAll();
        return;
      }
      if (key !== 'z') return;
      ev.preventDefault();
      if (ev.shiftKey) undo.redo();
      else undo.undo();
    } else if (key === 'f') void fit();
    else if (key === 'p') void present();
    else if (key === 'escape' && board.present) void present();
    else if (key === 'd') board.goDiscover();
    else if (key === 'e') board.goEdit();
    else if (key === 'l') board.goLive();
    else if (ev.key === 'v' || ev.key === 'V') tool = 'select';
    else if (ev.key === 'h' || ev.key === 'H') tool = 'hand';
  };
  // The board opens where it was left; one that was never placed is fitted to the window. An empty one is not: the
  // fit would wait for the first card added and then move the view under the next ones.
  const start = board.view
    ? { initialViewport: board.view }
    : board.nodes.length
      ? { fitView: true, fitViewOptions: FIT }
      : {};
  // A board left where none of its cards shows is brought back into view, once its cards have their sizes.
  let checked = false;
  $effect(() => {
    if (checked || !board.nodes.length || board.boxes.size < board.nodes.length) return;
    checked = true;
    const view = board.area();
    const shown = [...(area?.querySelectorAll('.svelte-flow__node') ?? [])].some(card => {
      const box = card.getBoundingClientRect();
      return box.right > view.left && box.left < view.right && box.bottom > view.top && box.top < view.bottom;
    });
    if (!shown) void fit(0);
  });
  /** A link from an app to a tunnel card: it leaves the app level with the card when it can, so it runs straight. */
  const linkPath = (app: Box, card: Box) => {
    const dx = card.x + card.w / 2 - (app.x + app.w / 2);
    const dy = card.y + card.h / 2 - (app.y + app.h / 2);
    const across = Math.abs(dx) * 0.6 > Math.abs(dy);
    const [fromSide, toSide]: [Side, Side] = across
      ? dx > 0
        ? ['right', 'left']
        : ['left', 'right']
      : dy > 0
        ? ['bottom', 'top']
        : ['top', 'bottom'];
    const to = sidePoint(card, toSide);
    const from = sidePoint(app, fromSide);
    const within = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
    if (across) from.y = within(to.y, app.y + 12, app.y + app.h - 12);
    else from.x = within(to.x, app.x + 12, app.x + app.w - 12);
    return { d: cablePath(from, fromSide, to, toSide), end: to };
  };
  const links = $derived(
    board.links.flatMap(({ from, to, tunnel }) => {
      const app = board.boxes.get(from);
      const card = board.infraBoxes.get(to);
      if (!app || !card) return [];
      const payload = { app: from, host: tunnel.bind, port: tunnel.port, original: tunnel.original };
      return [
        {
          key: `${from}>${to}`,
          from,
          to,
          host: tunnel.host,
          what: tunnel.what,
          payload,
          ...linkPath(app, card),
          idle: !live.up(from),
        },
      ];
    }),
  );
  const name = board.nameOf;
  /** Any card's name: an app's, or a queue's or a database's by its card key. */
  const cardName = (key: string) =>
    key.startsWith('queue:')
      ? board.queueName(key.slice(6))
      : key.startsWith('database:')
        ? board.databaseName(key.slice(9))
        : name(key);
  /** The menu a right click on a line to a tunnel or a database opens: show or hide the tunnel for that app. */
  let lineMenu = $state<{ x: number; y: number; app: string; host: string; show: boolean } | null>(null);
  const openLineMenu = (ev: MouseEvent, app: string, host: string, show: boolean) => {
    ev.preventDefault();
    lineMenu = { x: ev.clientX, y: ev.clientY, app, host, show };
  };
  /** What a light says when the pointer rests on it. */
  const about = (probe: Probe | undefined, what: string) =>
    probe?.state === 'busy'
      ? probe.detail
        ? `${probe.text ?? ''}. ${probe.detail}`
        : 'Testing…'
      : probe?.detail
        ? `${probe.text ?? ''}. ${probe.detail} Click to test again.`
        : `Not tested yet. Click to test that ${what}.`;
  /** Every cable and tunnel link that can be tested, with the apps that have to answer first. */
  const jobs = $derived<Job[]>([
    ...board.edges.map(({ id, source, target }) => ({
      key: id,
      apps: [source, target],
      payload: { from: source, to: target },
    })),
    ...links.map(({ key, from, payload }) => ({ key, apps: [from], payload })),
  ]);
  /** A message link or a database line, between the sides of its two cards that face each other. */
  const flows = $derived(
    board.flows.flatMap(({ from, to, queue, database, via }) => {
      const box = (key: string) => board.boxes.get(key) ?? board.infraBoxes.get(key);
      const [a, b] = [box(from), box(to)];
      if (!a || !b) return [];
      const dx = b.x + b.w / 2 - (a.x + a.w / 2);
      const dy = b.y + b.h / 2 - (a.y + a.h / 2);
      const level: [Side, Side] = dx > 0 ? ['right', 'left'] : ['left', 'right'];
      let sides: [Side, Side] =
        Math.abs(dx) * 0.6 > Math.abs(dy) ? level : dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
      // An app's side with its tunnel and queue cards is left to them: a link from elsewhere leaves sideways
      // instead. A card of the app's own stack is joined on whichever side it sits, as it is moved around the app.
      const own = board.ledBy(from).includes(to) || board.ledBy(to).includes(from);
      const taken = (key: string, side: Side) =>
        board.boxes.has(key) && !!board.ledBy(key).length && board.infraSide(key) === side;
      if (!own && (taken(from, sides[0]) || taken(to, sides[1]))) sides = level;
      // A database's line leaves its tunnel card from the database's own row, on the right unless it lies to the left.
      const row = database ? board.rowY[from]?.[database] : undefined;
      if (row !== undefined)
        sides = [
          b.x + b.w < a.x ? 'left' : 'right',
          // Stacked with the tunnel card, it comes round on the same side instead of back behind the card.
          b.x > a.x + a.w ? 'left' : b.x + b.w < a.x ? 'right' : 'right',
        ];
      let [start, end] = [
        row === undefined ? sidePoint(a, sides[0]) : { x: sides[0] === 'right' ? a.x + a.w : a.x, y: a.y + row },
        sidePoint(b, sides[1]),
      ];
      // A line never runs behind another card: it goes round them, on the side its far end leans to.
      const others = [...board.boxes, ...board.infraBoxes].filter(([key]) => key !== from && key !== to);
      const under = (p: Point, q: Point) =>
        others.filter(([, box]) =>
          [0.2, 0.35, 0.5, 0.65, 0.8].some(t => {
            const x = p.x + (q.x - p.x) * t;
            const y = p.y + (q.y - p.y) * t;
            return x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
          }),
        );
      const routed = row === undefined && (!database || board.boxes.has(from));
      let blocking = routed ? under(start, end) : [];
      // Blocked, the sides that face each other across can still be clear.
      if (blocking.length && sides[0] !== level[0] && !(taken(from, level[0]) || taken(to, level[1]))) {
        const across = [sidePoint(a, level[0]), sidePoint(b, level[1])] as const;
        if (!under(...across).length) {
          sides = level;
          [start, end] = across;
          blocking = [];
        }
      }
      let detour: Point | undefined;
      if (blocking.length) {
        const side: Side = b.x + b.w / 2 <= a.x + a.w / 2 ? 'left' : 'right';
        sides = [side, side];
        // Each end as near the other as its side allows, clear of the cables at the side's middle.
        const near = (box: Box, y: number) => ({
          ...sidePoint(box, side),
          y: Math.min(Math.max(y, box.y + 24), box.y + box.h - 24),
        });
        [start, end] = [near(a, b.y + b.h / 2), near(b, a.y + a.h / 2)];
        const edges = [a, b, ...blocking.map(([, box]) => box)];
        detour = {
          x:
            side === 'left'
              ? Math.min(...edges.map(box => box.x)) - 40
              : Math.max(...edges.map(box => box.x + box.w)) + 40,
          y: (start.y + end.y) / 2,
        };
      }
      // Which way it goes: a chevron 6px clear of the ring it lands in, pointing in. A database is read and written.
      const [nx, ny] = SIDES[sides[1]];
      const tip = { x: end.x + nx * 13, y: end.y + ny * 13 };
      const back = { x: end.x + nx * 18, y: end.y + ny * 18 };
      const arrow = database
        ? undefined
        : `M${String(back.x - ny * 5)} ${String(back.y + nx * 5)}L${String(tip.x)} ${String(tip.y)}L${String(back.x + ny * 5)} ${String(back.y - nx * 5)}`;
      const verb = database
        ? 'reads and writes'
        : queue
          ? to.startsWith('queue:')
            ? 'publishes to'
            : 'reads'
          : 'calls';
      // Said by whoever acts: the app that reads a queue, not the queue. A tunnel's row carries its database.
      const [who, what] = queue && from.startsWith('queue:') ? [to, from] : [from, to];
      const host = from.startsWith('tunnel:') ? from.split(':')[1] : undefined;
      const middle = detour ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      return [
        {
          key: `${from}>${to}`,
          from,
          to,
          arrow,
          verb: verb.split(' ')[0] ?? verb,
          says: host ? `${cardName(to)}, through the tunnel to ${host}` : `${cardName(who)} ${verb} ${cardName(what)}`,
          middle,
          // A line straight from an app to a deployed database: its tunnel can be shown again from it.
          tunnel:
            database && !board.databases[database] && board.boxes.has(from) ? board.tunnelOf(database) : undefined,
          d: detour ? throughPath(start, sides[0], end, sides[1], [detour]) : cablePath(start, sides[0], end, sides[1]),
          start,
          end,
          kind: queue
            ? board.queues[queue] === 'local'
              ? 'msg local'
              : 'msg'
            : database && board.databases[database]
              ? 'db local'
              : row === undefined
                ? 'db'
                : 'db row',
          via,
          // Beside the link, not on it: right of one running up or down, over one running across.
          label: detour
            ? {
                x: detour.x + (sides[0] === 'left' ? -8 : 8),
                y: detour.y,
                anchor: sides[0] === 'left' ? 'end' : 'start',
              }
            : SIDES[sides[0]][0] === 0
              ? { x: (start.x + end.x) / 2 + 8, y: (start.y + end.y) / 2, anchor: 'start' }
              : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 9, anchor: 'middle' },
        },
      ];
    }),
  );
  // The flow draws a picked card over the rest, and else the later ones over the earlier ones.
  const above = $derived(
    new Map(board.nodes.map((node, at) => [node.id, (node.selected ? board.nodes.length : 0) + at])),
  );
  /** Whether a card that is drawn over this card's end sits on it: then the end is hidden with the card under. */
  const covered = (at: { x: number; y: number }, owner: string): boolean => {
    const mine = above.get(owner) ?? 0;
    return [...board.boxes].some(
      ([id, box]) =>
        id !== owner &&
        (above.get(id) ?? 0) > mine &&
        at.x > box.x + 1 &&
        at.x < box.x + box.w - 1 &&
        at.y > box.y + 1 &&
        at.y < box.y + box.h - 1,
    );
  };
  const frame = () => new Promise(requestAnimationFrame);
  $effect(() => {
    board.brief = viewport.current.zoom < FAR_ZOOM || board.live;
  });
  // The board alone, full screen where the browser allows it, fitted once the rest of the page has gone.
  // Full screen follows the board, one change at a time; the browser's word about a change made here is not news.
  let syncing = false;
  const present = async () => {
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
  };
  // Fitted in full when the whole board fits that close; else zoomed out, where the cards are short.
  // The view is worked out here and set once: a fit the flow queues runs again each time the cards change form.
  const MAX_FRAMES = 40;
  const STEADY_FRAMES = 3;
  const fit = async (duration = FIT.duration) => {
    const viewFor = (boxes: Box[], maxZoom: number) => {
      const x = Math.min(...boxes.map(box => box.x));
      const y = Math.min(...boxes.map(box => box.y));
      const bounds = {
        x,
        y,
        width: Math.max(...boxes.map(box => box.x + box.w)) - x,
        height: Math.max(...boxes.map(box => box.y + box.h)) - y,
      };
      return getViewportForBounds(bounds, area?.clientWidth ?? 0, area?.clientHeight ?? 0, 0.2, maxZoom, FIT.padding);
    };
    const inFull = () => [
      ...board.nodes.map(node => ({ ...node.position, ...(full[node.id] ?? board.boxes.get(node.id) ?? CARD) })),
      ...board.infra.map(card => ({ ...card.position, ...(board.infraBoxes.get(card.id) ?? CARD) })),
    ];
    const drawn = () => [...board.boxes.values(), ...board.infraBoxes.values()];
    // Zoomed in, the cards turn full a few frames later: wait until their sizes hold.
    const untilSizesSettle = async () => {
      const sizes = () => JSON.stringify([...board.boxes.values(), ...board.infraBoxes.values()]);
      let last = '';
      let held = 0;
      for (let wait = 0; wait < MAX_FRAMES && held < STEADY_FRAMES; wait++) {
        await frame();
        const now = sizes();
        held = now === last && !board.brief ? held + 1 : 0;
        last = now;
      }
    };
    if (!area || !board.nodes.length) return;
    for (let tries = 0; tries < 2; tries++) {
      const close = viewFor(inFull(), FIT.maxZoom);
      if (close.zoom < FAR_ZOOM) break;
      await flow.setViewport(close, { duration: tries ? duration : 0 });
      await untilSizesSettle();
      // Measured in full, the cards under a grown card have moved down with it: fitted to where all are drawn now.
      const now = viewFor(drawn(), FIT.maxZoom);
      if (now.zoom >= FAR_ZOOM) {
        await flow.setViewport(now, { duration });
        return;
      }
    }
    if (!board.brief) {
      await flow.setViewport(viewFor(inFull(), FIT.maxZoom), { duration: 0 });
      await frame();
      await frame();
    }
    await flow.setViewport(viewFor(drawn(), FAR_ZOOM - 0.01), { duration });
  };
  // Each card's last height and the form it was measured in: a change of form is not the card growing.
  // Each card's size in full, as Edit draws it close up: the board is laid out for that, in Live too.
  const full: Record<string, { w: number; h: number } | undefined> = {};
  $effect(() => {
    if (viewport.current.zoom < FAR_ZOOM || board.live) return;
    for (const [id, { w, h }] of board.boxes) full[id] = { w, h };
    const heights = Object.fromEntries([...board.boxes].map(([id, box]) => [id, Math.round(box.h)]));
    if (Object.entries(heights).some(([id, h]) => board.fullHeights[id] !== h))
      untrack(() => (board.fullHeights = { ...board.fullHeights, ...heights }));
  });
  const arrange = async () => {
    // Cards are placed by their full size, so pressing again changes nothing, whatever the zoom or the view.
    // In Edit, a card never seen in full brings the board in close first, to be measured.
    if (!board.live && viewport.current.zoom < FAR_ZOOM && !board.nodes.every(node => full[node.id])) {
      await flow.setZoom(1, { duration: 0 });
      await frame();
      await frame();
    }
    // Short cards keep their full width; their full height is the one kept with the board.
    const size = (id: string) => {
      const box = board.boxes.get(id) ?? { w: 260, h: 160 };
      return full[id] ?? { w: box.w, h: board.fullHeights[id] ?? box.h };
    };
    board.arrange(size);
    // The cards move first; the view follows once they are placed.
    requestAnimationFrame(() => void fit());
  };
  // A board that was just opened: once its cards have their sizes it is arranged, or only brought into view.
  $effect(() => {
    const how = board.opened;
    if (!how || !board.nodes.every(node => node.measured?.width)) return;
    board.opened = null;
    if (how === 'arrange') void arrange();
    else requestAnimationFrame(() => void fit());
  });
</script>

<svelte:window
  onkeydown={(ev: KeyboardEvent) => {
    if (ev.key === 'Escape') lineMenu = null;
    hold(ev);
    space(ev);
    shortcut(ev);
  }}
  onkeyup={(ev: KeyboardEvent) => {
    hold(ev);
    space(ev);
  }}
  onblur={() => {
    spaceHeld = false;
    lineMenu = null;
  }}
  onpointermovecapture={release}
  onpointerdowncapture={(ev: PointerEvent) => {
    pressed = { x: ev.clientX, y: ev.clientY };
    if (!(ev.target as Element).closest('.line-menu')) lineMenu = null;
  }}
  onpointerupcapture={() => (pressed = null)}
/>

<!-- A card reached with Tab is the picked one: the arrow keys move it straight away. -->
<div
  class="area"
  role="presentation"
  bind:this={area}
  ondragover={ev => {
    if (ev.dataTransfer?.types.includes('text/app')) ev.preventDefault();
  }}
  ondrop={ev => {
    const id = ev.dataTransfer?.getData('text/app');
    if (!id || board.live) return;
    ev.preventDefault();
    board.add(id, { x: ev.clientX, y: ev.clientY });
  }}
  onfocusin={ev => {
    const id = (ev.target as Element).matches('.svelte-flow__node')
      ? (ev.target as Element).getAttribute('data-id')
      : null;
    if (id && !panning && ![...board.nodes, ...board.infra].find(node => node.id === id)?.selected) board.pick(id);
  }}
>
  <SvelteFlow
    class={{ panning }}
    bind:nodes={
      () => board.flowNodes(),
      (drawn: (CardNode | InfraNode)[]) => {
        // Moved by a card's change of size, not by anyone: no step of its own to undo.
        if (board.fromFlow(drawn, `${String(viewport.current.zoom < FAR_ZOOM)} ${String(board.live)}`, live.asked))
          undo.adopt();
      }
    }
    bind:edges={board.edges}
    nodeTypes={{ app: AppCard, tunnel: Tunnel, queue: Queue, database: Database }}
    edgeTypes={{ cable: Cable }}
    connectionMode={ConnectionMode.Loose}
    deleteKey={board.live ? null : ['Backspace', 'Delete']}
    nodesDraggable={!board.live && !panning}
    elementsSelectable={!panning}
    multiSelectionKey={['Shift', 'Meta', 'Control']}
    nodeDragThreshold={4}
    nodeClickDistance={4}
    panOnScroll
    panOnScrollSpeed={1}
    panOnDrag={panning ? true : [1, 2]}
    selectionOnDrag={!panning}
    onselectionstart={() => (board.selecting = true)}
    onselectionend={() => (board.selecting = false)}
    selectionMode={SelectionMode.Partial}
    colorMode={isLight(appearance.now.scheme) ? 'light' : 'dark'}
    minZoom={0.2}
    proOptions={{ hideAttribution: true }}
    {...start}
    onmoveend={(_event, viewport) => {
      if (!board.live) board.view = { ...viewport, x: viewport.x + shift };
    }}
  >
    <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} bgColor="var(--desk)" patternColor="var(--line)" />
    <Panel position="bottom-center">
      <div class="tools" role="toolbar" aria-label="Board">
        <div class="switch" role="radiogroup" aria-label="Dragging on the board">
          {#each TOOLS as [name, title, icon] (name)}
            <button
              class="tool"
              type="button"
              role="radio"
              aria-checked={tool === name}
              aria-label={title}
              {title}
              onclick={() => (tool = name)}
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
        <button
          aria-label="Arrange"
          title="Arrange cards by who calls whom, callers on top"
          onclick={() => void arrange()}><Icon of={LayoutGrid} size={16} /></button
        >
        <button aria-label="Fit" title="Zoom to fit all apps (F)" onclick={() => void fit()}
          ><Icon of={Focus} size={16} /></button
        >
        <div class="zoom" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" title="Zoom out" onclick={zoomBy(1 / 1.2)}><Icon of={Minus} size={16} /></button
          >
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
          onclick={() => void present()}
        >
          <Icon of={Maximize} size={16} />
        </button>
        {#if !board.present}
          <button
            class="clear"
            title="Remove every card from this board. Undo brings them back."
            disabled={!board.nodes.length}
            onclick={() => {
              const n = board.nodes.length;
              runs.review = {
                title: `Clear ${board.name ?? 'this board'}?`,
                sub: `Takes ${n === 1 ? 'its app' : `all ${String(n)} apps`} and their cables off the board. Undo brings them back.`,
                notices: [],
                groups: [],
                ok: 'Clear board',
                prod: true,
                blocked: false,
                confirm: () => {
                  board.clear();
                },
              };
            }}>Clear</button
          >
        {/if}
      </div>
    </Panel>
    <!-- The whole board at a glance; dragging in it moves the view, scrolling on it zooms. -->
    <MiniMap
      position="bottom-right"
      pannable
      zoomable
      width={168}
      height={112}
      ariaLabel="Overview of the board"
      nodeBorderRadius={0}
      nodeStrokeWidth={0}
      nodeColor={node => (node.type === 'app' ? 'var(--ink-muted)' : 'var(--line-strong)')}
      bgColor="var(--panel)"
      maskColor="color-mix(in oklab, var(--desk) 72%, transparent)"
      maskStrokeColor="var(--line)"
      maskStrokeWidth={1}
    />
    <!-- Under the cards: the links from each app to its tunnels. -->
    <ViewportPortal target="back">
      <svg class="links" aria-hidden="true">
        {#each links as link (link.key)}
          <path
            class="link"
            class:idle={link.idle}
            class:dimmed={board.dimmedLink(link.from, link.to)}
            class:lit={board.lit(link.from, link.to)}
            class:snapped={board.snapped.includes(`${link.from}>${link.to}`)}
            d={link.d}
          />
          <path
            class="hit"
            role="presentation"
            d={link.d}
            oncontextmenu={ev => {
              if (board.databasesOf(link.from).some(one => board.tunnelOf(one) === link.host))
                openLineMenu(ev, link.from, link.host, false);
            }}
          />
        {/each}
        {#each flows as flow (flow.key)}
          <g
            class="flow {flow.kind}"
            data-link={flow.key}
            class:dimmed={board.dimmedLink(flow.from, flow.to)}
            class:lit={board.lit(flow.from, flow.to)}
            class:snapped={board.snapped.includes(`${flow.from}>${flow.to}`)}
          >
            <path class="under" d={flow.d} />
            <path class="wire" d={flow.d} />
            <!-- Pointed at, it thickens and says who does what. -->
            <path
              class="hit"
              role="presentation"
              d={flow.d}
              data-tunnel={flow.tunnel}
              oncontextmenu={ev => {
                if (flow.tunnel) openLineMenu(ev, flow.from, flow.tunnel, true);
              }}><title>{flow.says}</title></path
            >
            <circle class="dot" cx={flow.start.x} cy={flow.start.y} r="3.5" />
            {#if flow.arrow}
              <circle class="ring" cx={flow.end.x} cy={flow.end.y} r="6" />
              <path class="arrow" d={flow.arrow} />
            {:else}
              <circle class="dot" cx={flow.end.x} cy={flow.end.y} r="3.5" />
            {/if}
            {#if board.lit(flow.from, flow.to) && board.focus?.ids.length}
              <g class="verb" transform="translate({flow.middle.x} {flow.middle.y})">
                <rect x={-(flow.verb.length * 3.4 + 7)} y="-9" width={flow.verb.length * 6.8 + 14} height="18" />
                <text>{flow.verb}</text>
              </g>
            {/if}
            {#if flow.via}<text class="via" x={flow.label.x} y={flow.label.y} text-anchor={flow.label.anchor}
                >{flow.via}</text
              >{/if}
          </g>
        {/each}
      </svg>
    </ViewportPortal>
    <!-- Above every card, a picked one too: each cable's two ends, which the pointer can grab, and the cable being drawn. -->
    <ViewportPortal target="front" style="position: absolute; z-index: 1001">
      <svg
        class="ends"
        class:reordering={!!wiring.grabbed}
        class:drawing={!!wiring.draft}
        class:still={board.live}
        role="group"
        aria-label="Cable ends"
      >
        {#each board.edges as edge, index (edge.id)}
          {@const a = wiring.endPoint(index, 'from')}
          {@const b = wiring.endPoint(index, 'to')}
          {#if a && b}
            {#if !covered(a, edge.source)}
              <circle
                role="presentation"
                class="plug nodrag nopan"
                class:cut={board.hovered === edge.id}
                class:idle={!live.up(edge.source) || !live.up(edge.target)}
                class:dimmed={board.dimmedLink(edge.source, edge.target)}
                data-cable={edge.id}
                class:grabbed={wiring.grabbed?.id === edge.id && wiring.grabbed.end === 'from'}
                cx={a.x}
                cy={a.y}
                r="3.5"
                onpointerdown={ev => {
                  wiring.grabEnd(ev, edge.id, 'from');
                }}
              />
            {/if}
            {@const tested = live.sent(edge.source) && live.sent(edge.target)}
            {@const probe = probes.results[edge.id]}
            {#if !covered(b, edge.target)}
              <!-- Tested, the socket is a button for the keyboard too. -->
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <circle
                role={tested ? 'button' : 'presentation'}
                tabindex={tested ? 0 : undefined}
                aria-label={tested ? `Test that local ${name(edge.target)} answers ${name(edge.source)}` : undefined}
                onkeydown={ev => {
                  if (!tested || (ev.key !== 'Enter' && ev.key !== ' ')) return;
                  ev.preventDefault();
                  void probes.test({ key: edge.id, payload: { from: edge.source, to: edge.target } });
                }}
                class="socket nodrag nopan"
                class:dimmed={board.dimmedLink(edge.source, edge.target)}
                class:tested
                data-cable={edge.id}
                data-state={tested ? probe?.state : undefined}
                class:grabbed={wiring.grabbed?.id === edge.id && wiring.grabbed.end === 'to'}
                cx={b.x}
                cy={b.y}
                r="7"
                onpointerdown={ev => {
                  pressedAt = { x: ev.clientX, y: ev.clientY };
                  wiring.grabEnd(ev, edge.id, 'to');
                }}
                onclick={ev => {
                  // A press that slid reordered the cables or drew a new one: only a press in place tests.
                  if (tested && Math.hypot(ev.clientX - pressedAt.x, ev.clientY - pressedAt.y) < 6)
                    void probes.test({ key: edge.id, payload: { from: edge.source, to: edge.target } });
                }}
                >{#if tested}<title>{about(probe, `local ${name(edge.target)} answers`)}</title>{/if}</circle
              >
              <circle
                class="light"
                data-state={tested ? (probe?.state ?? 'idle') : undefined}
                data-light={edge.id}
                cx={b.x}
                cy={b.y}
                r="3.4"
              />
            {/if}
          {/if}
        {/each}
        <!-- Where a tunnel link reaches its card: whether the app gets to its database or cache through the tunnel. -->
        {#each links as link (link.key)}
          {#if live.sent(link.from)}
            {@const probe = probes.results[link.key]}
            <circle
              role="button"
              tabindex="0"
              aria-label="Test that {name(link.from)} reaches its {link.what.toLowerCase()} through the tunnel"
              onkeydown={ev => {
                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                ev.preventDefault();
                void probes.test(link);
              }}
              class="socket tested press nodrag nopan"
              data-link={link.key}
              data-state={probe?.state}
              cx={link.end.x}
              cy={link.end.y}
              r="7"
              onpointerdown={ev => {
                ev.stopPropagation();
              }}
              onclick={() => void probes.test(link)}
              ><title
                >{about(probe, `${name(link.from)} reaches its ${link.what.toLowerCase()} through the tunnel`)}</title
              ></circle
            >
            <circle
              class="light"
              data-state={probe?.state ?? 'idle'}
              data-light={link.key}
              cx={link.end.x}
              cy={link.end.y}
              r="3.4"
            />
          {/if}
        {/each}
        {#if draft}
          <path class="draft" d={draft} />
        {/if}
      </svg>
    </ViewportPortal>
  </SvelteFlow>
  {#if !board.nodes.length}
    <div class="empty">
      <p>Click the apps you want to run together.<br />Connect them; the board is saved as you go.</p>
      {#if lately.length && !board.live}
        <ul aria-label="Or open a board">
          {#each lately as { preset, team, at } (`${team ? 'team' : 'own'}:${preset.name}`)}
            <li>
              <button
                type="button"
                onclick={() => {
                  openBoard(preset);
                }}
              >
                <span class="name">{preset.name}</span>
                <span class="meta">{team ? 'Team board' : 'Your board'}{at ? `, opened ${ago(at)}` : ''}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  {#if lineMenu}
    {@const menu = lineMenu}
    <div class="line-menu" role="menu" aria-label="Line" style:left="{menu.x}px" style:top="{menu.y}px">
      <button
        type="button"
        role="menuitem"
        onclick={() => {
          board.showTunnelFor(menu.app, menu.host, menu.show);
          lineMenu = null;
        }}>{menu.show ? 'Show' : 'Hide'} tunnel for {name(menu.app)}</button
      >
    </div>
  {/if}
</div>

<style>
  /* Moving the board, a drag or scroll on a card's action bar moves it too. */
  :global(.svelte-flow.panning .svelte-flow__node-toolbar) {
    pointer-events: none;
  }
  .links .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
  }
  .line-menu {
    position: fixed;
    z-index: 2000;
    display: grid;
    min-width: 200px;
    padding: 4px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    box-shadow: var(--lift);
  }
  .line-menu button {
    padding: 8px 10px;
    border: 0;
    background: none;
    color: var(--ink);
    font: 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .line-menu button:hover,
  .line-menu button:focus-visible {
    background: color-mix(in oklab, var(--ink) 9%, transparent);
  }
  .area {
    position: absolute;
    inset: 0;
    container-type: inline-size;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    margin: 0;
    padding: 0 24px;
    color: var(--muted);
    font: 15px/1.55 var(--sans);
    text-align: center;
    text-wrap: balance;
    pointer-events: none;
  }
  .empty p {
    margin: 0;
  }
  .empty ul {
    display: flex;
    flex-direction: column;
    width: min(380px, 100%);
    margin: 18px auto 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    list-style: none;
    text-align: left;
    pointer-events: auto;
  }
  .empty ul::before {
    content: 'Or open a board';
    padding: 10px 14px 6px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .empty li + li {
    border-top: 1px solid var(--line);
  }
  .empty button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-height: 44px;
    padding: 8px 14px;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .empty button:hover,
  .empty button:focus-visible {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
    outline: none;
  }
  .empty .name {
    font-weight: 600;
    font-size: 14px;
  }
  .empty .meta {
    color: var(--muted);
    font-size: 12px;
  }
  /* Over the toolbar, with the other ways to move the view. */
  /* Centred, clear of the overview on either side. */
  .area :global(.svelte-flow__panel.bottom.center) {
    --overview-room: 230px;
    /* Centred from the middle, it would only get the right half's width: its own, up to the limit, keeps one row. */
    width: max-content;
    max-width: calc(100% - 2 * var(--overview-room));
  }
  /* Too narrow for the toolbar between two overview-wide margins (a panel open beside it): the overview goes, and the
     toolbar keeps its one row. */
  @container (max-width: 880px) {
    .area :global(.svelte-flow__minimap) {
      display: none;
    }
    .area :global(.svelte-flow__panel.bottom.center) {
      max-width: calc(100% - 32px);
    }
  }
  .area :global(.svelte-flow__minimap) {
    margin: 0 15px 15px 0;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    background: var(--panel);
  }
  .links {
    position: absolute;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .links path {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* A tunnel link says "uses", not a direction: a plain line. Dashed until its app runs. */
  .link.idle {
    stroke-dasharray: 5 5;
    stroke-linecap: butt;
  }
  /* Message links are teal, dashed while the queue is the deployed one. */
  .flow .via {
    fill: var(--muted);
    font: 600 11px var(--mono);
    dominant-baseline: middle;
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 5px;
    stroke-linejoin: round;
  }
  .flow .under {
    stroke: var(--desk);
    stroke-width: 7;
    opacity: 0.75;
  }
  /* Each kind of link in one tone: its line, the dot where it leaves, the ring and chevron where it lands. */
  .flow {
    --tone: var(--socket-rim);
  }
  .flow .wire {
    stroke: var(--tone);
    stroke-width: 2;
  }
  .flow .dot {
    fill: var(--tone);
  }
  .flow .ring {
    fill: var(--desk);
    stroke: var(--tone);
    stroke-width: 2;
  }
  .flow .arrow {
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .flow .hit {
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
  }
  .flow:hover .wire {
    stroke-width: 3;
  }
  /* Message links are teal, dashed while the queue is the deployed one. */
  .flow.msg {
    --tone: var(--msg);
  }
  .flow.msg .wire {
    stroke-dasharray: 7 5;
    stroke-linecap: butt;
  }
  .flow.msg.local .wire {
    stroke-dasharray: none;
    stroke-linecap: round;
  }
  /* A line to a deployed database is dotted in the deployed colour; to one on this Mac, solid in the local colour. */
  .flow.db {
    --tone: var(--deployed);
  }
  .flow.db .wire {
    stroke-dasharray: 2 4;
  }
  .flow.db.local {
    --tone: var(--local);
  }
  .flow.db.local .wire {
    stroke-dasharray: none;
  }
  .flow.db.lit .wire {
    stroke-width: 3;
  }
  /* Snapped straight while a card is dragged: the line goes a shade darker, nothing more. */
  .link.snapped {
    stroke: var(--ink);
    --tone: var(--ink);
  }
  .flow.msg.snapped {
    --tone: color-mix(in oklab, var(--msg) 60%, var(--ink));
  }
  /* The picked card's own links stand out like its cables. */
  .link.lit {
    stroke: var(--ink);
    stroke-width: 2.5;
  }
  .flow.msg.lit .wire {
    stroke-width: 3.5;
  }
  /* What the link does, beside it, while one of its cards is picked. */
  .flow .verb rect {
    fill: var(--desk);
    stroke: var(--line-strong);
  }
  .flow .verb text {
    fill: var(--ink);
    font: 600 11px var(--sans);
    dominant-baseline: middle;
    text-anchor: middle;
    stroke: none;
  }
  .ends {
    position: absolute;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .plug,
  .socket {
    pointer-events: auto;
    cursor: grab;
  }
  .reordering,
  .reordering * {
    cursor: grabbing;
  }
  /* While a cable is drawn, the ends of the others are part of their card. */
  .drawing :is(.plug, .socket) {
    cursor: inherit;
  }
  /* Where a cable leaves: a small dot, grabbed by a wider clear edge. Where it plugs in: a ring whose hole holds the last
     connection test. */
  .plug {
    fill: var(--cable);
    stroke: transparent;
    stroke-width: 6;
  }
  .plug.idle {
    fill: color-mix(in oklab, var(--cable) 45%, var(--line-strong));
  }
  .plug.cut {
    fill: var(--bad);
  }
  .plug.grabbed {
    r: 7.5px;
  }
  .socket {
    fill: var(--desk);
    stroke: var(--local);
    stroke-width: 2;
  }
  .socket.tested:hover {
    stroke: var(--ink);
  }
  .socket[data-state='bad'] {
    stroke: var(--prod);
  }
  .socket.press {
    cursor: pointer;
  }
  .socket:focus-visible {
    outline: none;
    stroke: var(--cable);
    stroke-width: 3;
  }
  .socket.grabbed {
    r: 10px;
  }
  /* The test's result has a shape of its own, never colour alone: nothing until tested, a turning arc while it
     tests, a solid dot when it works, a hollow ring when it answered oddly, and red when it fails. */
  .light {
    display: none;
    fill: none;
    stroke-width: 1.5;
  }
  .light[data-state='ok'],
  .light[data-state='bad'] {
    display: inline;
    r: 3.4px;
  }
  .light[data-state='ok'] {
    fill: var(--live);
  }
  .light[data-state='bad'] {
    fill: var(--prod);
  }
  .light[data-state='warn'],
  .light[data-state='busy'] {
    display: inline;
    r: 2.65px;
    stroke: var(--warn);
  }
  .light[data-state='busy'] {
    /* Three quarters of the ring. */
    stroke-dasharray: 12.5 16.7;
    transform-box: fill-box;
    transform-origin: center;
    animation: testing 0.9s linear infinite;
  }
  @keyframes testing {
    to {
      rotate: 360deg;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .light[data-state='busy'] {
      animation: none;
    }
  }
  .draft {
    fill: none;
    stroke: var(--cable);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-dasharray: 6 6;
  }
  /* In Live nothing on the board is pulled or unplugged. */
  .ends.still :is(.plug, .socket) {
    pointer-events: none;
  }
  .ends.still .socket.tested {
    pointer-events: auto;
    cursor: pointer;
  }
  .area:has(.ends.still) :global(.svelte-flow__edge) {
    pointer-events: none;
  }
  /* The board's tools: words printed on one strip, each with its key. */
  /* Each word keeps its own edge, so a strip that wraps on a narrow board stays a clean grid. */
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
  /* Canvas tools as icons in square cells, as in other canvas tools; Clear stays a word. */
  .tools button {
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
  .tools button:hover:not(:disabled) {
    background: color-mix(in oklab, var(--ink) 8%, var(--panel));
  }
  .tools button:focus-visible {
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
  .tools button:disabled {
    color: color-mix(in oklab, var(--ink-muted) 45%, transparent);
    cursor: default;
  }
  .tools .clear:hover {
    color: var(--prod);
  }
  .line path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .select path {
    fill: currentColor;
  }
  .hand path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* A group picked by dragging an area keeps each card's own outline, not a box around them all that stays over
     the cards and takes their clicks; dragging any picked card still moves the group. */
  .area :global(.svelte-flow__selection-wrapper) {
    display: none;
  }
  .area :global(.svelte-flow__selection) {
    border: 1px solid var(--cable);
    border-radius: 3px;
    background: color-mix(in oklab, var(--cable) 12%, transparent);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--line);
  }
</style>
