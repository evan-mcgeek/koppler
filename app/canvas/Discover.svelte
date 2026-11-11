<script lang="ts">
  // The Discover view: how the stack fits together, the board's apps marked, read from its facts. Picking traces; the panel
  // lists a card's links; Plan a run with these takes the picked apps to Plan. Nothing here runs or changes the board.
  import Sparkle from '@lucide/svelte/icons/sparkle';
  import X from '@lucide/svelte/icons/x';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Laptop from '@lucide/svelte/icons/laptop';
  import Clock from '@lucide/svelte/icons/clock';
  import { untrack } from 'svelte';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import {
    SvelteFlow,
    Background,
    BackgroundVariant,
    Panel,
    ViewportPortal,
    useSvelteFlow,
    type Node,
  } from '@xyflow/svelte';
  import { around, facing, SIDES, type Box } from '../src/core/cables.ts';
  import { along, layOut, routePath } from '../src/core/layout.ts';
  import { engine } from './elk.ts';
  import { linksOf, sourceOf, type Card, type Link } from '../src/core/discover.ts';
  import AreaFilter from './AreaFilter.svelte';
  import { areaNames, chosen } from './areas.svelte.ts';
  import { isLight, appearance } from './appearance.svelte.ts';
  import { board } from './board.svelte.ts';
  import { AREAS, CARD, discovered, linkKey, type LeanData } from './discover.svelte.ts';
  import FeaturePanel from './FeaturePanel.svelte';
  import FeatureStart from './FeatureStart.svelte';
  import FindCard from './FindCard.svelte';
  import { heldKeys } from './held-keys.ts';
  import LeanCard from './LeanCard.svelte';
  import BoardTools from './BoardTools.svelte';
  import Overview from './Overview.svelte';
  import { dragging, FIT, present, toolState, type Tool } from './tools.svelte.ts';
  import { undo } from './undo.svelte.ts';
  import { live } from './live.svelte.ts';

  const flow = useSvelteFlow();
  const map = $derived(discovered.map);
  // A step picked is brought into view, both its cards, without zooming in.
  $effect(() => {
    const step = discovered.current?.step;
    if (step)
      untrack(
        () =>
          void flow.fitView({
            nodes: [{ id: step.from }, { id: step.to }],
            duration: 200,
            maxZoom: flow.getZoom(),
            padding: 0.3,
          }),
      );
  });
  // From when a refit is due until its motion ends: the map says so (data-moving), for whoever waits for it to be still.
  let moving = $state(0);
  const motion = (wait: (go: () => void) => void, move: () => Promise<unknown>) => {
    moving++;
    wait(() => {
      void move().finally(() => moving--);
    });
  };
  // The map refits when it gains cards, once each is placed, or the panel takes or gives back its room; a map not
  // shown never answers.
  const shown = $derived(map.cards.length > 0);
  const placed = $derived(map.cards.every(({ card }) => discovered.positions[card]));
  // Read when the refit is due, after the wait, not as it was asked.
  const stillShown = () => shown;
  const shape = $derived(`${String(map.cards.length)}:${String(!!discovered.last)}:${String(placed)}`);
  $effect(() => {
    if (shape && shown && placed)
      untrack(() => {
        motion(
          go => setTimeout(go, 80),
          () => (stillShown() ? flow.fitView({ duration: 200, maxZoom: 1, padding: 0.15 }) : Promise.resolve()),
        );
      });
  });
  const near = $derived.by(() => {
    const picked = discovered.picked;
    if (!picked.length) return null;
    const touching = map.links.filter(({ from, to }) => picked.includes(from) || picked.includes(to));
    return new Set([...picked, ...touching.flatMap(({ from, to }) => [from, to])]);
  });
  /** A phase picked: the cards of its steps; the rest dim. */
  const inPhase = $derived.by(() => {
    const phase = discovered.phase === null ? undefined : board.feature?.phases[discovered.phase];
    return phase ? new Set(phase.steps.flatMap(step => [step.from, step.to])) : null;
  });
  /** Walking through the steps: the two cards of the step on screen; the rest dim. */
  const walking = $derived(
    discovered.current ? new Set([discovered.current.step.from, discovered.current.step.to]) : null,
  );
  // What the flow measured and where a card is while it is dragged: kept across redraws so fitting sees every card.
  let flowState = $state.raw<Record<Card, Node>>({});
  /** Where a card is: where it is being dragged, else where it was put. */
  const placeOf = (card: Card) => (flowState[card]?.dragging && flowState[card].position) || discovered.positions[card];
  const nodes = $derived(
    // A card without its place yet is drawn hidden, so it is measured before the layout places it.
    map.cards.map(({ card, onBoard, outside }): Node<LeanData> => ({
      id: card,
      type: 'lean',
      ...(flowState[card]?.measured && { measured: flowState[card].measured }),
      position: placeOf(card) ?? { x: 0, y: 0 },
      data: discovered.data(card, onBoard, outside),
      selected: discovered.picked.includes(card),
      class: [
        !placeOf(card) && 'unplaced',
        near && !near.has(card) && 'dimmed',
        walking && !walking.has(card) && 'dimmed',
        !walking && inPhase && !inPhase.has(card) && 'dimmed',
      ]
        .filter(Boolean)
        .join(' '),
    })),
  );
  const box = (card: Card): Box | undefined => {
    const at = placeOf(card);
    return at && { x: at.x, y: at.y, w: CARD.w, h: discovered.heights[card] ?? CARD.h };
  };
  const onBoard = $derived(new Set(map.cards.filter(one => one.onBoard).map(one => one.card)));
  /** A scheduled job and the app whose repo it ships from, both on the map: a dashed line, not a cable, joins them. */
  const sameRepo = $derived(
    discovered.sameRepo.flatMap(([from, job]) => {
      const [a, b] = [box(from), box(job)];
      if (!a || !b) return [];
      const { sides, level } = facing(a, b);
      const routed = around(a, b, { sides, level, others: [] });
      const middle = routed.detour ?? {
        x: (routed.start.x + routed.end.x) / 2,
        y: (routed.start.y + routed.end.y) / 2,
      };
      return [{ key: `${from}~${job}`, d: routed.d, middle }];
    }),
  );
  /** Each link from the side of one card that faces the other: a dot where it leaves, a ring and chevron where it lands. */
  const drawn = $derived.by(() => {
    return map.links.flatMap(link => {
      const [a, b] = [box(link.from), box(link.to)];
      if (!a || !b) return [];
      // As Arrange laid it out, round every card; a card moved since takes its links round what is in the way.
      const path = (() => {
        const route = discovered.routeOf(link, placeOf);
        const [first, last, before] = [route?.[0], route?.at(-1), route?.at(-2)];
        if (route && first && last && before) {
          const out = Math.hypot(before.x - last.x, before.y - last.y) || 1;
          return {
            start: first,
            end: last,
            d: routePath(route),
            middle: along(route, 0.5),
            normal: [(before.x - last.x) / out, (before.y - last.y) / out] as const,
          };
        }
        const { sides: facingSides, level } = facing(a, b);
        const others = map.cards.flatMap(({ card }) => {
          const other = card !== link.from && card !== link.to && box(card);
          return other ? [other] : [];
        });
        const routed = around(a, b, { sides: facingSides, level, others });
        const { start, end } = routed;
        return {
          start,
          end,
          d: routed.d,
          middle: routed.detour ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
          normal: SIDES[routed.sides[1]],
        };
      })();
      const { start, end, d, middle } = path;
      const [nx, ny] = path.normal;
      const both = link.kind === 'uses' || (link.kind === 'bucket' && link.via === 'both');
      const arrow = both
        ? ''
        : `M${String(end.x + nx * 18 - ny * 5)} ${String(end.y + ny * 18 + nx * 5)}L${String(end.x + nx * 13)} ${String(end.y + ny * 13)}L${String(end.x + nx * 18 + ny * 5)} ${String(end.y + ny * 18 - nx * 5)}`;
      const step = discovered.stepOf(link);
      const phase = discovered.phase;
      return [
        {
          key: linkKey(link),
          link,
          d,
          start,
          end,
          arrow,
          both,
          step,
          middle,
          // On a feature board its steps are drawn in ink and every other link drawn back.
          board: board.feature ? !!step : onBoard.has(link.from) && onBoard.has(link.to),
          found: link.sure === 'found' || !!step?.step.proposed,
          unsourced: !!link.unsourced && !step,
          // A bucket's link says whether it reads, writes or both.
          label: link.kind === 'bucket' && !step ? link.via : undefined,
          faded:
            (!!near && !(discovered.picked.includes(link.from) || discovered.picked.includes(link.to))) ||
            (phase !== null && step?.phase !== phase) ||
            (!!discovered.current && step?.number !== discovered.current.number),
        },
      ];
    });
  });
  /**
   * Each phase's name, just over the card its first step leaves: on a dense map the phases cross the same cards, so
   * each sits by its own start. Phases that start from one card stand side by side.
   */
  /** Each phase name's width as drawn, once measured. */
  let nameWidths = $state<Record<number, number>>({});
  const phases = $derived.by(() => {
    const taken: Record<Card, number> = {};
    return (board.feature?.phases ?? []).flatMap((phase, at) => {
      const first = phase.steps[0];
      const where = first && box(first.from);
      if (!first || !where) return [];
      const when = discovered.startsOn(phase);
      const width = (nameWidths[at] ?? phase.name.length * 8.5 + (when ? when.length * 7.2 + 30 : 0)) + 34;
      const x = where.x + (taken[first.from] ?? 0);
      taken[first.from] = x - where.x + width + 8;
      return [{ at, name: phase.name, when, width, x, y: where.y - 30 }];
    });
  });
  const proposals = $derived(discovered.proposals);
  const proposedCards = $derived(map.cards.filter(({ card }) => discovered.data(card, false).proposed).length);
  const name = (card: Card) => discovered.data(card, false).name;
  /** Where a call is in the caller's clone, as a link the editor opens. */
  const editorLink = (link: Link) => {
    const at = board.facts && sourceOf(board.facts, link);
    const clone = board.app(link.from)?.path;
    return at && clone ? `vscode://file${encodeURI(`${clone}/${at.file}`)}${at.line ? `:${String(at.line)}` : ''}` : '';
  };
  const tag = (card: Card) => discovered.data(card, false).tag;
  /** The picked card's links, by what they do, as the panel lists them. */
  const groups = $derived.by(() => {
    const card = discovered.last;
    if (!card) return [];
    // Its links to apps the chosen areas leave out are listed too, after the rest.
    const outside = new Set(map.cards.find(one => one.card === card)?.outside);
    const hidden = board.facts
      ? linksOf(board.facts).filter(link => outside.has(link.from === card ? link.to : link.from))
      : [];
    // On a feature board, every link the stack has for it, so any can be added as a step.
    const rest =
      board.feature && board.facts
        ? linksOf(board.facts).filter(
            link =>
              (link.from === card || link.to === card) &&
              !map.links.some(one => one.from === link.from && one.to === link.to && one.kind === link.kind),
          )
        : [];
    const of = (test: (link: Link) => boolean, other: (link: Link) => Card) =>
      [...map.links, ...hidden, ...rest]
        .filter(test)
        .map(link => ({ link, other: other(link), outside: outside.has(other(link)) }));
    const into = (kind: Link['kind']) => (link: Link) => link.kind === kind && link.to === card;
    const out = (kind: Link['kind']) => (link: Link) => link.kind === kind && link.from === card;
    const queue = card.startsWith('queue:');
    const database = card.startsWith('database:');
    const resource = card.startsWith('resource:') ? board.facts?.resources?.[card.slice(9)] : undefined;
    const bucket = (link: Link) => link.kind === 'bucket' && (link.from === card || link.to === card);
    const away = (link: Link) => (link.from === card ? link.to : link.from);
    if (resource)
      return resource.type === 's3'
        ? [{ title: 'Used by', rows: of(bucket, away) }]
        : resource.type === 'apigw'
          ? [{ title: 'Routes', rows: of(out('route'), link => link.to) }]
          : [{ title: 'Started by', rows: of(into('starts'), link => link.from) }];
    return [
      ...(queue || database
        ? []
        : [
            { title: 'Called by', rows: of(into('call'), link => link.from) },
            { title: 'Calls', rows: of(out('call'), link => link.to) },
            { title: 'Reads', rows: of(into('read'), link => link.from) },
            { title: 'Publishes', rows: of(out('publish'), link => link.to) },
            { title: 'Data', rows: of(out('uses'), link => link.to) },
            // Only when it has any: most apps use none.
            ...[
              { title: 'Buckets', rows: of(bucket, away) },
              { title: 'Routed from', rows: of(into('route'), link => link.from) },
              { title: 'Starts', rows: of(out('starts'), link => link.to) },
            ].filter(group => group.rows.length),
          ]),
      ...(queue
        ? [
            { title: 'Published by', rows: of(into('publish'), link => link.from) },
            { title: 'Read by', rows: of(out('read'), link => link.to) },
            { title: 'Fed by', rows: of(into('feeds'), link => link.from) },
            { title: 'Feeds', rows: of(out('feeds'), link => link.to) },
          ]
        : []),
      ...(database ? [{ title: 'Used by', rows: of(into('uses'), link => link.from) }] : []),
    ];
  });
  /** A Step Functions card's steps, listed in its panel. */
  const lastSteps = $derived.by(() => {
    const card = discovered.last;
    const resource = card?.startsWith('resource:') ? board.facts?.resources?.[card.slice(9)] : undefined;
    return resource?.type === 'sfn' ? (resource.steps ?? []) : undefined;
  });
  const lastApp = $derived(discovered.last ? board.app(discovered.last) : undefined);
  /** What the picked card's own face says; on the whole stack the card shows only its name and kind. */
  const lastData = $derived(discovered.last ? discovered.data(discovered.last, false) : null);
  const lastEdited = $derived(lastData?.edited ?? null);
  /** Who calls the picked card, by name, on the map or not. */
  const callers = $derived(
    discovered.last
      ? [
          ...new Set(
            (board.facts ? linksOf(board.facts) : [])
              .filter(link => link.kind === 'call' && link.to === discovered.last)
              .map(link => name(link.from)),
          ),
        ]
      : [],
  );
  const list = (names: string[]) =>
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${String(names.at(-1))}` : (names[0] ?? '');
  const lastStack = $derived(discovered.last ? board.facts?.apps[discovered.last] : undefined);
  const hiding = $derived(discovered.hiding);
  const chosenNames = $derived(chosen.ids.map(id => board.areas[id]?.name ?? id));
  /** Brings a card to the middle of the map and picks it. */
  const show = (card: Card) => {
    discovered.picked = [card];
    discovered.last = card;
    void flow.fitView({ nodes: [{ id: card }], duration: 200, maxZoom: flow.getZoom(), minZoom: flow.getZoom() });
  };
  let finding = $state(false);
  /** A card found that was not on the map: shown once the layout has placed it. */
  let bringing = $state<Card | null>(null);
  const found = (card: Card) => {
    bringing = card;
    if (!map.cards.some(one => one.card === card)) discovered.open(card);
  };
  $effect(() => {
    if (bringing && placeOf(bringing)) {
      show(bringing);
      bringing = null;
    }
  });
  // Apps a new choice of areas brings back take a free place, when the others were moved by hand.
  let choice = '';
  $effect(() => {
    const now = chosen.ids.join();
    if (now === choice) return;
    choice = now;
    untrack(() => {
      discovered.placeReturning();
    });
  });
  // The layout is worked out again whenever the map or the chosen layout changes; the same input, the same layout.
  $effect(() => {
    const { cards, links, key, measured } = discovered.layoutInput;
    if (!measured) return;
    const direction = discovered.direction;
    void layOut(cards, links, direction, engine()).then(laid => {
      if (discovered.layoutInput.key === key) discovered.laid = { ...laid, key };
    });
  });
  const { hold, release } = heldKeys();
  /** What a drag on the empty map does, and Space held to move it, as on a board. */
  const tools = toolState();
  const panning = $derived(tools.panning);
  const fit = async () => {
    await flow.fitView(FIT);
  };
  const presentMap = () => present(fit);
  // A map first laid out here is brought into view once it is.
  let fitWhenLaid = true;
  const arrange = () => {
    discovered.arrange();
    fitWhenLaid = true;
  };
  // The cards move first, once their layout is worked out; the view follows.
  $effect(() => {
    if (!discovered.layout || !fitWhenLaid) return;
    fitWhenLaid = false;
    untrack(() => {
      motion(requestAnimationFrame, fit);
    });
  });
  /** An area is being dragged over the map: on its way it covers one card alone, which is still no click. */
  let selecting = false;
  // The panel shows the card clicked, or the only one picked; an area picked opens nothing, as on a board.
  const pick = (cards: Card[]) => {
    discovered.picked = cards;
    discovered.last = selecting
      ? null
      : discovered.last && cards.includes(discovered.last)
        ? discovered.last
        : cards.length === 1
          ? (cards[0] ?? null)
          : null;
  };
  // The same keys as on a board: F fits, P presents, Cmd+Z undoes, Cmd+A picks every card.
  const keys = (ev: KeyboardEvent) => {
    if (ev.altKey) return;
    if ((ev.target as Element | null)?.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open], :popover-open')) return;
    const key = ev.key.toLowerCase();
    if (ev.metaKey || ev.ctrlKey) {
      if (key === 'k') {
        ev.preventDefault();
        finding = true;
      } else if (key === 'a') {
        ev.preventDefault();
        pick(map.cards.map(one => one.card));
      } else if (key === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) undo.redo();
        else undo.undo();
      }
      return;
    }
    if (key === '/') {
      ev.preventDefault();
      finding = true;
    } else if (key === 'e') board.toDoor('run');
    else if (key === 'l' && live.running) {
      board.toDoor('run');
      board.goLive();
    } else if (key === 'f') void fit();
    else if (key === 'p') void presentMap();
    else if (board.feature && (key === 'arrowright' || key === 'arrowleft')) {
      ev.preventDefault();
      discovered.walk(key === 'arrowright' ? 1 : -1);
    } else if (key === 'escape') {
      if (discovered.current) discovered.step = null;
      else if (board.present) void presentMap();
      else pick([]);
    }
  };
  const pickedNames = $derived(discovered.picked.map(name));
  const runnable = $derived(discovered.picked.filter(card => discovered.data(card, false).app));
  const notCloned = $derived(
    discovered.picked.filter(
      card => !card.includes(':') && !board.facts?.apps[card]?.outside && !runnable.includes(card),
    ),
  );
</script>

<svelte:window
  onkeydown={(ev: KeyboardEvent) => {
    hold(ev);
    tools.key(ev);
    keys(ev);
  }}
  onkeyup={(ev: KeyboardEvent) => {
    hold(ev);
    tools.key(ev);
  }}
  onblur={() => {
    tools.blur();
  }}
  onpointermovecapture={release}
/>

<div class="discover">
  <div
    class="map"
    class:narrowed={shown && hiding.apps.length > 0}
    aria-label="Discover map"
    data-moving={moving > 0 || undefined}
  >
    {#if !shown && board.feature}
      <FeatureStart />
    {:else if !shown}
      <div class="empty" role="status">
        <h2>No apps in this stack</h2>
        <p>Discover shows how the stack's apps fit together. Add an app in Plan.</p>
        <button
          class="primary"
          type="button"
          onclick={() => {
            board.toDoor('run');
          }}>Add apps</button
        >
      </div>
    {:else}
      <SvelteFlow
        bind:nodes={
          () => nodes,
          (next: Node[]) => {
            flowState = Object.fromEntries(next.map(node => [node.id, node]));
            // The pick is what the map has selected: a click, Shift-click or an area dragged over.
            const selected = next.filter(node => node.selected).map(node => node.id);
            if (selected.join() !== discovered.picked.join()) pick(selected);
          }
        }
        nodeTypes={{ lean: LeanCard }}
        edges={[]}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
        selectNodesOnDrag={false}
        {...dragging(panning)}
        nodesDraggable={!panning}
        nodesConnectable={false}
        deleteKey={null}
        colorMode={isLight(appearance.now.scheme) ? 'light' : 'dark'}
        proOptions={{ hideAttribution: true }}
        onnodeclick={({ node }) => {
          if (discovered.picked.includes(node.id)) discovered.last = node.id;
        }}
        onpaneclick={() => {
          pick([]);
        }}
        onselectionstart={() => {
          selecting = true;
          discovered.last = null;
        }}
        onselectionend={() => {
          selecting = false;
        }}
        onnodedragstop={({ targetNode }) => {
          if (targetNode) discovered.moved(targetNode.id, targetNode.position);
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.4}
          bgColor="var(--desk)"
          patternColor="var(--line)"
        />
        <ViewportPortal target="back">
          <svg class="links" aria-hidden="true">
            {#each sameRepo as one (one.key)}
              <g class="repo-line" data-repo={one.key}>
                <path d={one.d} />
                <text x={one.middle.x} y={one.middle.y - 6} text-anchor="middle">same repo</text>
              </g>
            {/each}
            {#each drawn as one (one.key)}
              <g
                class="link"
                class:board={one.board}
                class:found={one.found}
                class:faded={one.faded}
                data-link={one.key}
              >
                <path class="wire" d={one.d} />
                {#if !one.both}<path class="arrow" d={one.arrow} />{/if}
              </g>
            {/each}
            {#each drawn.filter(one => one.step) as one (one.key)}
              {#if one.step}
                {@const number = one.step.number}
                <g class="mark" class:board={one.board} class:faded={one.faded}>
                  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                  <g
                    class="number pick"
                    class:picked={discovered.step === number}
                    transform="translate({one.middle.x} {one.middle.y})"
                    onclick={() => {
                      discovered.step = discovered.step === number ? null : number;
                    }}
                  >
                    <rect
                      x={-one.step.number.length * 3.6 - 6}
                      y="-9"
                      width={one.step.number.length * 7.2 + 12}
                      height="18"
                    />
                    <text text-anchor="middle" dy="4">{one.step.number}</text>
                  </g>
                </g>
              {/if}
            {/each}
            {#each drawn.filter(one => one.unsourced) as one (one.key)}
              <g class="mark unsourced" class:board={one.board} class:faded={one.faded}>
                <g class="number" transform="translate({one.middle.x} {one.middle.y})">
                  <rect x="-9" y="-9" width="18" height="18" />
                  <text text-anchor="middle" dy="4">?</text>
                </g>
              </g>
            {/each}
            {#each drawn.filter(one => one.label) as one (one.key)}
              <text
                class="mark label"
                class:board={one.board}
                class:faded={one.faded}
                x={one.middle.x}
                y={one.middle.y}
                dy="4"
                text-anchor="middle">{one.label}</text
              >
            {/each}
          </svg>
        </ViewportPortal>
        <!-- Each phase's name over the cards, so no card covers it; a click shows only that phase. -->
        <ViewportPortal target="front" style="position: absolute; z-index: 1002">
          <svg class="titles">
            {#each phases as phase (phase.at)}
              <g
                class="phase"
                class:faded={discovered.phase !== null && discovered.phase !== phase.at}
                transform="translate({phase.x} {phase.y})"
                role="button"
                tabindex="0"
                aria-pressed={discovered.phase === phase.at}
                aria-label="Phase {phase.at + 1}: {phase.name}. Show only this phase"
                onclick={() => {
                  discovered.phase = discovered.phase === phase.at ? null : phase.at;
                }}
                onkeydown={ev => {
                  if (ev.key !== 'Enter' && ev.key !== ' ') return;
                  ev.preventDefault();
                  discovered.phase = discovered.phase === phase.at ? null : phase.at;
                }}
              >
                <title>Show only this phase</title>
                <!-- On the desk's colour, so a link passing under the label does not run through its words. -->
                <rect class="plate" x="-4" y="-3" width={phase.width} height="24" />
                <rect width="18" height="18" />
                <text class="at" x="9" y="13" text-anchor="middle">{phase.at + 1}</text>
                <text
                  class="name"
                  x="26"
                  y="14"
                  {@attach (text: SVGTextElement) => {
                    const width = Math.ceil(text.getComputedTextLength());
                    if (width && nameWidths[phase.at] !== width) nameWidths = { ...nameWidths, [phase.at]: width };
                  }}
                  >{phase.name}{#if phase.when}<tspan class="when" dx="10">◷ {phase.when}</tspan>{/if}</text
                >
              </g>
            {/each}
          </svg>
        </ViewportPortal>
        <!-- Each link's ends over the cards, so a ring on a card's edge shows whole. -->
        <ViewportPortal target="front" style="position: absolute; z-index: 1001">
          <svg class="ends" aria-hidden="true">
            {#each drawn as one (one.key)}
              <g class="end" class:board={one.board} class:faded={one.faded}>
                <circle class="dot" cx={one.start.x} cy={one.start.y} r="3.5" />
                {#if one.both}
                  <circle class="dot" cx={one.end.x} cy={one.end.y} r="3.5" />
                {:else}
                  <circle class="ring" cx={one.end.x} cy={one.end.y} r="6" />
                {/if}
              </g>
            {/each}
          </svg>
        </ViewportPortal>
        <Panel position="bottom-center">
          <BoardTools
            tool={tools.tool}
            ontool={(tool: Tool) => {
              tools.tool = tool;
            }}
            label="Discover"
            onarrange={arrange}
            onfit={() => void fit()}
            onpresent={() => void presentMap()}
          />
        </Panel>
        <Overview label="Overview of the map" strong="lean" />
      </SvelteFlow>

      {#if proposals.length}
        <div class="proposed" role="status">
          <Sparkle size={16} aria-hidden="true" />
          <span
            ><strong
              >The agent proposed {proposedCards
                ? `${String(proposedCards)} ${proposedCards === 1 ? 'card' : 'cards'} and `
                : ''}{proposals.length}
              {proposals.length === 1 ? 'link' : 'links'}.</strong
            > Each stays dashed until you accept it.</span
          >
          <button
            type="button"
            onclick={() => {
              discovered.drop(proposals);
            }}>Drop all</button
          >
          <button class="primary" type="button" onclick={() => void discovered.accept(proposals)}>Accept all</button>
        </div>
      {/if}

      <div class="legend" aria-label="Legend">
        {#if board.feature}
          <span class="lit"
            ><svg width="28" height="8" aria-hidden="true"><path d="M0 4H28" /></svg>Used by {board.name}</span
          >
        {/if}
        <span><svg width="28" height="8" aria-hidden="true"><path d="M0 4H28" /></svg>Confirmed</span>
        <span
          ><svg width="28" height="8" aria-hidden="true"><path d="M0 4H28" class="dash" /></svg>Found in code, not
          confirmed</span
        >
        <span class="unknown"
          ><svg width="28" height="14" aria-hidden="true"
            ><path d="M0 7H28" /><rect x="7" y="0.5" width="14" height="13" /><text x="14" y="10.5" text-anchor="middle"
              >?</text
            ></svg
          >No source yet</span
        >
        {#if board.feature}<span class="dim"
            ><svg width="28" height="8" aria-hidden="true"><path d="M0 4H28" /></svg>Other links</span
          >{/if}
      </div>

      {#if hiding.apps.length}
        <div class="hiding" role="region" aria-label="Hidden by your areas">
          <EyeOff size={14} aria-hidden="true" />
          <span class="said"
            >Showing {#each chosenNames as one, at (one)}<strong>{one}</strong>{at < chosenNames.length - 1
                ? ', '
                : ''}{/each} and apps with no area.
            <span class="count"
              >{hiding.apps.length}
              {hiding.apps.length === 1 ? 'app' : 'apps'} in {list(hiding.areas)}
              {hiding.apps.length === 1 ? 'is' : 'are'} hidden.</span
            ></span
          >
          <AreaFilter id={AREAS} />
          <button
            class="text"
            type="button"
            onclick={() => {
              chosen.set([]);
            }}>Show all</button
          >
        </div>
      {/if}

      {#if discovered.current}
        {@const { step, number } = discovered.current}
        <div class="pickbar stepbar" role="status" aria-label="Step {number}">
          <span class="said" title="{number} {name(step.from)} → {name(step.to)}{step.note ? `: ${step.note}` : ''}">
            <span class="what"><strong>{number}</strong> {name(step.from)} → {name(step.to)}</span>
            <span class="note">{step.note ?? ''}</span>
          </span>
          <button
            class="icon"
            type="button"
            aria-label="Previous step"
            title="Previous step (←)"
            onclick={() => {
              discovered.walk(-1);
            }}><ChevronLeft size={16} /></button
          >
          <button
            class="icon"
            type="button"
            aria-label="Next step"
            title="Next step (→)"
            onclick={() => {
              discovered.walk(1);
            }}><ChevronRight size={16} /></button
          >
          <button
            class="icon"
            type="button"
            aria-label="Stop"
            title="Stop (Esc)"
            onclick={() => {
              discovered.step = null;
            }}><X size={16} /></button
          >
        </div>
      {:else if discovered.picked.length}
        <div class="pickbar" role="status">
          <span
            ><strong>{discovered.picked.length} picked{discovered.picked.length > 2 ? '.' : ':'}</strong>
            {#if discovered.picked.length > 2}{notCloned.length
                ? `${String(notCloned.length)} ${notCloned.length === 1 ? "isn't" : "aren't"} cloned and will stay deployed`
                : ''}{:else}{pickedNames.join(', ')}{/if}</span
          >
          <button
            class="text"
            type="button"
            onclick={() => {
              discovered.picked = [];
              discovered.last = null;
            }}>Clear</button
          >
          {#if runnable.length}
            <button
              class="primary"
              type="button"
              onclick={() => {
                discovered.planRun();
              }}>Plan a run with these</button
            >
          {:else}
            <span class="nothing">Nothing to run: pick an app</span>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  {#if discovered.last}
    {@const card = discovered.last}
    <aside class="panel" aria-labelledby="discover-panel-title">
      <header>
        <span class="row">
          <h2 id="discover-panel-title">{name(card)}</h2>
          <span class="tag">{tag(card)}</span>
          <button
            class="close"
            type="button"
            aria-label="Close"
            onclick={() => {
              discovered.picked = discovered.picked.filter(one => one !== card);
              discovered.last = null;
            }}><X size={16} /></button
          >
        </span>
        {#if lastStack?.description}<p class="about">{lastStack.description}</p>{/if}
        {#if lastStack?.outside && typeof lastStack.outside === 'string'}<p class="about">{lastStack.outside}</p>{/if}
        {#if lastData?.job}<span
            class="where when"
            title="{lastData.job.expression || 'No schedule'}
Schedule on {lastData.job.env.toUpperCase()}. Every environment in Settings"
            ><Clock size={14} aria-hidden="true" />{lastData.job.words}{lastData.job.from
              ? ` · from ${lastData.job.from}`
              : ''} · deployed only</span
          >{/if}
        {#if lastData?.deadEnd}<span class="where dead">Dead end · no readers</span>{/if}
        {#if lastApp?.cloned}<span class="where"
            ><Laptop size={14} aria-hidden="true" />Cloned here{lastApp.current ? ` · ${lastApp.current}` : ''}</span
          >{#if lastApp.changed}<span class="where changed"
              ><GitBranch size={14} aria-hidden="true" />{lastApp.changed}{callers.length
                ? `. ${list(callers)} ${callers.length === 1 ? 'calls' : 'call'} it.`
                : ''}</span
            >{/if}{:else if lastStack && !lastStack.outside}<span class="where">On GitHub</span>{/if}
        {#if lastStack?.slug}<span class="slug">{lastStack.slug}</span>{/if}
        {#if lastEdited}<span class="edited">{lastEdited.says}</span>{/if}
      </header>
      {#each groups as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          {#if group.rows.length}
            {#each group.rows as { link, other, outside } (`${link.from}>${link.to}>${link.kind}`)}
              <div class="item" class:out={outside}>
                <span class="line">
                  <svg width="18" height="8" aria-hidden="true"
                    ><path d="M0 4H18" class:dash={link.sure === 'found' || outside} /></svg
                  >
                  <span class="tag">{tag(other)}</span>
                  {#if outside}
                    <!-- Hidden by the chosen areas: named, with its areas, not shown on the map. -->
                    <span class="name" title="Not in your areas">{name(other)}</span>
                    <span class="area">{areaNames(other).join(' · ')}</span>
                  {:else}
                    <button
                      class="name"
                      type="button"
                      onclick={() => {
                        show(other);
                      }}>{name(other)}</button
                    >
                    <span class="source">{link.sure === 'found' ? 'Code' : 'Stack'}</span>
                  {/if}
                </span>
                {#if board.feature}
                  {@const step = discovered.stepOf(link)}
                  {@const numbers = discovered.stepsOf(link).map(one => one.number)}
                  <span class="detail">
                    {#if step}<span
                        >Step{numbers.length > 1 ? 's' : ''}
                        {numbers.join(', ')}{step.step.proposed ? ', proposed' : ''}</span
                      >{:else}<span>Not in this feature</span>
                      <button
                        class="text"
                        type="button"
                        onclick={() => {
                          discovered.addStep(link);
                        }}>Add as a step</button
                      >{/if}
                  </span>
                {/if}
                {#if link.sure === 'found' && !discovered.stepOf(link)?.step.proposed}
                  <span class="detail">
                    <span>Found in code, not confirmed</span>
                    <button class="text" type="button" onclick={() => void discovered.confirm(link)}>Confirm</button>
                  </span>
                {:else if link.unsourced}<span class="detail"><span>No source yet</span></span>{:else if link.via}<span
                    class="detail"><span>{link.via}</span></span
                  >{/if}
                {#if editorLink(link)}
                  <span class="detail"
                    ><a
                      class="text"
                      href={editorLink(link)}
                      title="Opens in VS Code, or the editor that takes vscode:// links">Open in editor</a
                    ></span
                  >
                {/if}
              </div>
            {/each}
          {:else}
            <p class="none">Nothing found</p>
          {/if}
        </section>
      {/each}
      {#if lastSteps}
        <section>
          <h3>Steps, in order</h3>
          {#each lastSteps as step, at (at)}
            <div class="step">
              <span class="at">{at + 1}</span>
              <span
                >{step.name}{#if step.calls && board.facts?.apps[step.calls]}
                  {@const calls = step.calls}<span class="calls"
                    >Calls <button
                      class="name"
                      type="button"
                      onclick={() => {
                        show(calls);
                      }}>{name(calls)}</button
                    ></span
                  >{/if}</span
              >
            </div>
          {/each}
        </section>
      {/if}
    </aside>
  {:else if board.feature && map.cards.length}
    <FeaturePanel feature={board.feature} />
  {/if}
  <FindCard
    open={finding}
    onpick={found}
    onclose={() => {
      finding = false;
    }}
  />
</div>

<style>
  /* Not a cable: no call goes along it, so it is dashed, muted and ends in nothing. */
  .repo-line path {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1;
    stroke-dasharray: 3 4;
  }
  .phase .when {
    fill: var(--ink-muted);
    font: 12px var(--mono);
  }
  .repo-line text {
    fill: var(--ink-muted);
    font: 11px var(--mono);
  }
  .discover {
    display: flex;
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .map {
    --strip: 0px;
    position: relative;
    flex: 1;
    min-width: 0;
    background: var(--desk);
    container-type: inline-size;
  }
  /* The line on what the areas hide takes the bottom of the map; what sits there moves up over it. */
  .map.narrowed {
    --strip: 56px;
  }
  .map.narrowed :global(.svelte-flow__panel.bottom) {
    margin-bottom: calc(15px + var(--strip));
  }
  .hiding {
    position: absolute;
    right: 16px;
    bottom: 16px;
    left: 16px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    box-sizing: border-box;
    padding: 6px 12px;
    border: 1px dashed var(--line-strong);
    background: var(--desk);
    color: var(--ink);
    font: 400 13px var(--sans);
  }
  .hiding .said {
    flex: 1;
    min-width: 0;
  }
  .hiding strong {
    font-weight: 600;
  }
  .hiding .count {
    color: var(--ink-muted);
  }
  .item.out .name {
    color: var(--ink-muted);
    font-weight: 400;
    text-decoration: none;
    cursor: default;
  }
  .area {
    color: var(--ink-muted);
    font: 400 11px var(--mono);
    white-space: nowrap;
  }
  :global(.svelte-flow__node.unplaced) {
    visibility: hidden;
  }
  .links,
  .ends,
  .titles {
    position: absolute;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  /* Between two of the board's apps a link is ink; out to the ring it is drawn back. Dashed: found, not confirmed. */
  .link,
  .end,
  .mark {
    --tone: var(--line-strong);
  }
  .link.board,
  .end.board,
  .mark.board {
    --tone: var(--ink);
  }
  .link .wire {
    fill: none;
    stroke: var(--tone);
    stroke-width: 1.5;
  }
  .link.found .wire {
    stroke-dasharray: 5 4;
  }
  .end .dot {
    fill: var(--tone);
  }
  .end .ring {
    fill: var(--desk);
    stroke: var(--tone);
    stroke-width: 1.5;
  }
  .link .arrow {
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .link.faded,
  .end.faded,
  .mark.faded,
  .phase.faded {
    opacity: 0.25;
  }
  .phase {
    cursor: pointer;
    pointer-events: auto;
    outline: none;
  }
  .phase:hover .plate,
  .phase:focus-visible .plate {
    stroke: var(--ink);
  }
  .phase[aria-pressed='true'] .plate {
    stroke: var(--ink);
    stroke-width: 2;
  }
  /* A step's number on its link, in mono, on the desk so the line breaks around it. */
  .number rect {
    fill: var(--desk);
    stroke: var(--tone);
  }
  .number text {
    fill: var(--ink);
    font: 600 11px var(--mono);
  }
  /* A step's number picks its row in the panel; picked, it is outlined as a picked phase is. */
  .pick {
    cursor: pointer;
    pointer-events: auto;
  }
  .pick.picked rect {
    stroke: var(--ink);
    stroke-width: 2;
  }
  /* Recorded with nothing on where it comes from: a ? on the link, in a box like a step's number. */
  .unsourced .number rect {
    stroke: var(--ink-muted);
  }
  .label {
    fill: var(--ink-muted);
    font: 400 12px var(--sans);
    paint-order: stroke;
    stroke: var(--desk);
    stroke-width: 10px;
    stroke-linejoin: miter;
  }
  .step {
    display: flex;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
    font: 400 13px var(--sans);
    color: var(--ink);
  }
  .step .at {
    width: 16px;
    flex: none;
    color: var(--ink-muted);
    font: 400 11px var(--mono);
    line-height: 18px;
  }
  .step .calls {
    display: block;
    color: var(--ink-muted);
    font-size: 12px;
  }
  .phase rect {
    fill: var(--ink);
  }
  .phase .plate {
    fill: var(--desk);
  }
  .phase .at {
    fill: var(--desk);
    font: 600 11px var(--mono);
  }
  .phase .name {
    fill: var(--ink);
    font: 600 15px var(--sans);
  }
  .proposed {
    position: absolute;
    top: 16px;
    left: 16px;
    right: 16px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px 10px 16px;
    border: 1px dashed var(--ink);
    background: var(--desk);
    color: var(--ink-muted);
    font: 400 13px var(--sans);
  }
  .proposed > span {
    flex: 1;
    min-width: 0;
  }
  .proposed strong {
    color: var(--ink);
    font-weight: 600;
  }
  .proposed button:not(.primary) {
    padding: 8px 14px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .legend .unknown rect {
    fill: var(--desk);
    stroke: var(--ink-muted);
  }
  .legend .unknown text {
    fill: var(--ink);
    font: 600 10px var(--mono);
  }
  .legend .lit path {
    stroke: var(--ink);
    stroke-width: 2;
  }
  :global(.svelte-flow__node.dimmed) {
    opacity: 0.25;
  }
  .legend {
    position: absolute;
    left: 16px;
    bottom: calc(16px + var(--strip));
    z-index: 5;
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    background: var(--desk);
    color: var(--ink);
    font: 400 12px var(--sans);
  }
  /* Too narrow for the legend beside the pick bar: it goes to the top. */
  @container (width < 900px) {
    .legend {
      top: 16px;
      bottom: auto;
    }
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .legend path {
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }
  .legend .dash,
  .item .dash {
    stroke-dasharray: 5 4;
  }
  .legend .dim {
    color: var(--ink-muted);
  }
  .legend .dim path {
    stroke: var(--line-strong);
  }
  .pickbar {
    position: absolute;
    left: 50%;
    bottom: calc(64px + var(--strip));
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--ink);
    background: var(--panel);
    color: var(--ink);
    font: 400 13px var(--sans);
    white-space: nowrap;
    transform: translateX(-50%);
  }
  /* One size for every step, so its arrows stay under the pointer: two lines, each cut short, the whole in its title. */
  .stepbar {
    gap: 4px;
    width: min(560px, calc(100% - 32px));
  }
  .stepbar .said {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 0;
    margin-right: 10px;
  }
  .stepbar .what,
  .stepbar .note {
    min-height: 1.3em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stepbar strong {
    font: 600 12px var(--mono);
  }
  .stepbar .note {
    color: var(--ink-muted);
    font-size: 12px;
  }
  .stepbar button.icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .stepbar button.icon:hover {
    background: var(--desk);
  }
  .nothing {
    padding: 8px 14px;
    border: 1px dashed var(--line-strong);
    color: var(--ink-muted);
    font: 600 13px var(--sans);
  }
  button.primary {
    padding: 8px 14px;
    border: 0;
    background: var(--local);
    color: var(--desk);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  button.text,
  a.text {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .empty {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    gap: 10px;
    justify-items: start;
    width: min(420px, calc(100% - 32px));
    padding: 22px 22px 20px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    transform: translate(-50%, -50%);
  }
  .empty h2 {
    margin: 0;
    font: 600 22px var(--display);
  }
  .empty p {
    margin: 0;
    color: var(--ink-muted);
    font: 400 14px/1.5 var(--sans);
  }
  .panel {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 340px;
    overflow-y: auto;
    padding: 16px 18px;
    border-left: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }
  .panel header {
    display: grid;
    gap: 6px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .panel h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font: 600 22px var(--display);
  }
  .tag {
    flex: none;
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    color: var(--ink-muted);
    font: 400 10px var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 400 13px var(--sans);
  }
  .where.dead {
    color: var(--warn);
    font-weight: 600;
  }
  .edited {
    color: var(--ink);
    font: 400 12px/1.5 var(--sans);
  }
  .where.changed {
    align-items: flex-start;
    color: var(--ink-muted);
    font-size: 12px;
    line-height: 1.5;
  }
  .where.changed :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .slug {
    color: var(--ink-muted);
    font: 400 12px var(--mono);
  }
  .about {
    margin: 0;
    color: var(--ink-muted);
    font-size: 13px;
  }
  section {
    display: flex;
    flex-direction: column;
    padding-top: 12px;
  }
  h3 {
    margin: 0;
    color: var(--ink-muted);
    font: 600 12px var(--sans);
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .line path {
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  .item .name,
  .step .name {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 600 14px var(--sans);
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .step .name {
    font-size: 12px;
  }
  .source {
    color: var(--ink-muted);
    font: 400 12px var(--sans);
    white-space: nowrap;
  }
  .detail {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 26px;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
  }
  .detail span {
    flex: 1;
    min-width: 0;
  }
  .detail button.text,
  .detail a.text {
    font-size: 12px;
  }
  .none {
    margin: 0;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
    color: var(--ink-muted);
    font: 400 13px var(--sans);
  }
  :is(button):focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
