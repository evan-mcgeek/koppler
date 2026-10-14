<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Icon from './Icon.svelte';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Logs from '@lucide/svelte/icons/logs';
  import Play from '@lucide/svelte/icons/play';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import Cog from './Cog.svelte';
  import Command from './Command.svelte';
  import BranchPicker from './BranchPicker.svelte';
  import { Handle, NodeToolbar, Position, useViewport, type NodeProps } from '@xyflow/svelte';
  import type { Side } from '../src/core/arrange.ts';
  import { board, FAR_ZOOM, type CardNode } from './board.svelte.ts';
  import { wiring } from './wiring.svelte.ts';
  import { live, progress } from './live.svelte.ts';
  import { logs } from './logs.svelte.ts';
  import { runs } from './run.svelte.ts';
  import { dialogs } from './dialogs.svelte.ts';

  const { id, data, selected, dragging }: NodeProps<CardNode> = $props();
  // The action bar shows while the card or the bar is pointed at, and stays a moment as the pointer crosses the gap.
  let hovered = $state(false);
  let leaving: ReturnType<typeof setTimeout> | undefined;
  const show = () => {
    clearTimeout(leaving);
    hovered = true;
  };
  const hide = () => {
    leaving = setTimeout(() => (hovered = false), 250);
  };
  const bar = $derived(hovered || selected);
  const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
  const CHANGES = [
    ['set-aside', 'Set aside', 'Kept aside while it runs the other branch, back on Stop'],
    ['take-along', 'Take along', 'Carried to the other branch, and back on Stop'],
  ] as const;
  const STARTERS = [
    ['cli', 'Koppler'],
    ['ide', 'Me'],
  ] as const;
  const viewport = useViewport();
  const far = $derived(viewport.current.zoom < FAR_ZOOM);
  /** The short card: zoomed out, or in the Live view. It shows state, not fields. */
  const brief = $derived(far || board.live);
  // Short, the card keeps its full width: the board is spaced for that, so neighbours never run into each other.
  let width = $state(0);
  let fullWidth = $state(0);
  $effect(() => {
    if (!brief && width) fullWidth = width;
  });
  const app = $derived(board.app(id));
  const current = $derived(app?.current || 'current branch');
  const uncommitted = $derived(`${String(app?.dirty ?? 0)} uncommitted ${app?.dirty === 1 ? 'change' : 'changes'}`);
  const starts = $derived(!!app?.runIn.some(([value]) => value === 'ide'));
  const tunnels = $derived(board.tunnelsOf(id));
  const queues = $derived(board.queuesOf(id));
  const hiddenQueues = $derived(queues.filter(queue => board.hiddenQueues[queue]));
  const noQueues = $derived(queues.length > 0 && !data.showQueues);
  const calls = $derived(board.deployedCalls(id));
  /** "Acme Web Portal" reads as "Web Portal" on an Acme card. */
  const short = (name: string) => {
    const [first, ...rest] = name.split(' ');
    return rest.length && first === data.name.split(' ')[0] ? rest.join(' ') : name;
  };
  const local = $derived(board.localLibraries(id));
  const useLocal = (name: string, on: boolean) => {
    board.set(id, { libraries: on ? [...local, name] : local.filter(one => one !== name) });
  };
  const mobile = $derived(!!app?.platforms.length && data.run === 'cli');
  const platform = $derived(app?.platforms.find(([value]) => value === data.platform)?.[1]);
  /** What the short card says about how it runs. */
  const runLabel = $derived(data.run === 'ide' ? 'Started by you' : mobile ? platform : undefined);
  /** Worked out when the menu is opened. */
  let cables = $state<ReturnType<typeof board.cablesOf>>({ can: [], wired: [] });
  let noting = $state(false);
  const up = $derived(live.up(id));
  const where = $derived(live.where(id));
  const steps = $derived(live.steps(id));
  const [tone, said] = $derived(steps.length ? progress(steps) : ['todo', '']);
  const failed = $derived(steps.find(step => step.state === 'failed'));
  let open = $state(false);
  let asked = $state(false);
  /** A side whose one cable sits on the port: the ring stays lit under its end. */
  const lit = (side: Side) => board.ends.onPort.some(port => port.id === id && port.side === side);
  const wire = (ev: Event) => {
    const menu = ev.currentTarget as HTMLSelectElement;
    const [what, to] = [menu.value[0], menu.value.slice(1)];
    if (what === '+') board.connect(id, to);
    else if (what === '-') board.cut(id, to);
    menu.value = '';
  };
  const fieldAt = (ev: Event) =>
    (ev.target as Element).closest<HTMLElement>('select, textarea, input:not([type="radio"], [type="checkbox"])');
  // The whole card drags, so a field is held back on a press and opened by the click that follows a press that did
  // not move. One that is being typed in takes the press itself, for the caret, and the card stays.
  const hold = (ev: MouseEvent) => {
    const field = fieldAt(ev);
    if (field === document.activeElement) ev.stopPropagation();
    else if (field) ev.preventDefault();
  };
  const release = (ev: MouseEvent) => {
    const field = fieldAt(ev);
    if (!field || field === document.activeElement) return;
    field.focus();
    if (field instanceof HTMLSelectElement) field.showPicker();
  };
  const grow = (box: HTMLTextAreaElement) => {
    box.style.height = 'auto';
    box.style.height = `${String(box.scrollHeight + 2)}px`;
  };
</script>

<!-- What can be done with the card, in a bar above it while it is pointed at or picked: the title keeps its room. -->
<NodeToolbar isVisible={bar && !dragging} position={Position.Top} align="end" offset={6}>
  <span
    class="tools nodrag"
    data-card={id}
    class:reading={board.live}
    role="toolbar"
    tabindex="-1"
    aria-label="{data.name} actions"
    onpointerenter={show}
    onpointerleave={hide}
  >
    {#if runs.started.includes(id)}
      <button
        class="stop"
        type="button"
        aria-label="Stop {data.name}"
        title="Stop this app; its changes stay"
        onclick={() => void runs.stopApp(id)}
      >
        <Icon of={Square} size={15} filled />
      </button>
      <button
        type="button"
        aria-label="Restart {data.name}"
        title="Restart this app; the rest keeps running"
        onclick={() => {
          runs.start({ restart: id });
        }}
      >
        <Icon of={RotateCw} size={15} />
      </button>
    {:else}
      <button
        type="button"
        aria-label="Run {data.name} alone"
        title="Run alone: just this app and its tunnels, on a board of its own"
        onclick={() => {
          runs.alone(id);
        }}
      >
        <Icon of={Play} size={15} filled />
      </button>
    {/if}
    {#if live.hasLog(id)}
      <button
        type="button"
        aria-label="Show log"
        title="Show log"
        onclick={() => {
          logs.open(id);
        }}
      >
        <Icon of={Logs} size={15} />
      </button>
    {/if}
    <button
      type="button"
      aria-label="Settings for {data.name}"
      title="Settings: every fact the stack has about it"
      onclick={() => void dialogs.settings?.open({ title: data.name, path: `apps.${id}` })}
    >
      <Cog size={15} />
    </button>
    <button
      class="remove"
      type="button"
      aria-label="Remove {data.name}"
      title="Take off the board"
      onclick={() => {
        board.remove(id);
      }}
    >
      <Icon of={X} size={15} />
    </button>
  </span>
</NodeToolbar>

<article
  class="card kind-{data.kind}"
  class:selected
  class:short={brief}
  class:far
  class:reading={board.live}
  class:drop-ok={wiring.drop?.id === id && wiring.drop.ok}
  class:drop-bad={wiring.drop?.id === id && !wiring.drop.ok}
  class:wiring={!!wiring.draft}
  bind:offsetWidth={width}
  onpointerenter={show}
  onpointerleave={hide}
  style:width={brief && fullWidth ? `${String(fullWidth)}px` : undefined}
>
  <header>
    <span class="grip" aria-hidden="true" title="Drag to move">
      <Icon of={GripVertical} size={14} />
    </span>
    {#if up !== null}
      <span class="live" data-on={up} role="img" aria-label={up ? 'Running' : 'Not answering'} title={live.about(id)}
      ></span>
    {/if}
    <span class="name" title={data.name}>{data.name}</span>
    <span class="kind">{data.kindLabel}</span>
  </header>
  {#if brief}
    <p class="glance">
      <span title="Branch: {data.branch || current}">{data.branch || current}</span>
      {#if runLabel}<span>{runLabel}</span>{/if}
      {#if noQueues}<span title="It is taken off its queues and keeps the deployed ones">No queues</span>{/if}
      {#if data.hideTunnels && tunnels.length}<span
          class="off"
          title="Only the API runs; calls through its tunnels fail">No tunnels</span
        >{/if}
    </p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="body" onmousedowncapture={hold} onclick={release}>
      <label class="field">
        Branch
        <BranchPicker
          value={data.branch}
          current={app?.current ?? ''}
          branches={app?.branches ?? []}
          title={app?.dirty && !board.switchesOver(id) ? `Runs with your ${uncommitted}` : undefined}
          onpick={(branch: string) => {
            board.set(id, { branch });
          }}
        />
      </label>
      {#if board.switchesOver(id)}
        <div
          class="field"
          role="radiogroup"
          aria-label="Your {uncommitted} on {current}"
          title="Your {uncommitted} on {current}: set aside while it runs the other branch, or taken along. Back on Stop either way."
        >
          {uncommitted}
          <span class="seg">
            {#each CHANGES as [value, label, tip] (value)}
              <label title={tip}>
                <input
                  type="radio"
                  name="changes-{id}"
                  {value}
                  checked={(data.changes ?? 'set-aside') === value}
                  onchange={() => {
                    board.set(id, { changes: value });
                  }}
                />{label}
              </label>
            {/each}
          </span>
        </div>
      {/if}
      {#if starts || tunnels.length || queues.length}
        <div class="row">
          {#if starts}
            <div
              class="field"
              role="group"
              aria-label="Who starts it"
              title="Koppler: the agent starts it. Me: you start it yourself (IDE, terminal, anything); the agent only prepares it."
            >
              Started by
              <span class="seg">
                {#each STARTERS as [value, label] (value)}
                  <label>
                    <input
                      type="radio"
                      name="run-{id}"
                      {value}
                      checked={data.run === value}
                      onchange={() => {
                        board.set(id, { run: value });
                      }}
                    />{label}
                  </label>
                {/each}
              </span>
            </div>
          {/if}
          {#if mobile}
            <label class="field">
              Platform
              <span class="combo">
                <select
                  class="mono"
                  value={data.platform}
                  onchange={ev => {
                    board.set(id, { platform: ev.currentTarget.value });
                  }}
                >
                  {#each app?.platforms ?? [] as [value, label] (value)}<option {value}>{label}</option>{/each}
                </select>
              </span>
            </label>
          {/if}
          {#if tunnels.length}
            <div class="field">
              Tunnels
              <label
                class="toggle"
                title={data.hideTunnels
                  ? 'Off: only the API runs; calls through its tunnels fail.'
                  : 'On: Koppler opens its tunnels. Turn off when you only need the API.'}
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Open {data.name}'s tunnels"
                  checked={!data.hideTunnels}
                  onchange={ev => {
                    board.set(id, { hideTunnels: !ev.currentTarget.checked });
                  }}
                /><span class="track" aria-hidden="true"></span>{data.hideTunnels ? 'Off' : 'On'}
              </label>
            </div>
          {/if}
          {#if queues.length}
            <div class="field">
              Queues
              <label
                class="toggle"
                title={noQueues
                  ? 'Off: it is taken off its queues and keeps the deployed ones. A queue another app uses stays on the board for that app.'
                  : 'On: its queues show on the board, where each can be switched to a local copy.'}
              >
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Show {data.name}'s queues"
                  checked={!noQueues}
                  onchange={ev => {
                    board.set(id, { showQueues: ev.currentTarget.checked });
                  }}
                /><span class="track" aria-hidden="true"></span>{noQueues ? 'Off' : 'On'}
              </label>
              {#if hiddenQueues.length && !noQueues}
                <button
                  class="link"
                  type="button"
                  onclick={() => {
                    board.showQueues(queues, true);
                  }}>Show {hiddenQueues.length} hidden</button
                >
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      {#if app?.libraries.length}
        <div class="field">
          Libraries
          {#each app.libraries as library (library.name)}
            {@const on = local.includes(library.name)}
            <label
              class="toggle"
              title={on
                ? `On: ${data.name} uses your local copy in ${library.path.replace(/^\/Users\/[^/]+/, '~')}`
                : `Off: ${data.name} uses the published ${library.name}`}
            >
              <input
                type="checkbox"
                role="switch"
                aria-label="Use the local {library.name}"
                checked={on}
                onchange={ev => {
                  useLocal(library.name, ev.currentTarget.checked);
                }}
              /><span class="track" aria-hidden="true"></span>{library.name}
            </label>
          {/each}
        </div>
      {/if}
      <label class="field">
        Cables
        <span class="combo">
          <select
            aria-label="Add or remove a cable from {data.name}"
            onfocus={() => (cables = board.cablesOf(id))}
            onpointerdown={() => (cables = board.cablesOf(id))}
            onchange={wire}
          >
            <option value="">Add or remove…</option>
            {#if cables.can.length}
              <optgroup label="Call a local app">
                {#each cables.can as other (other.id)}<option value="+{other.id}">{other.name}</option>{/each}
              </optgroup>
            {/if}
            {#if cables.wired.length}
              <optgroup label="Remove the cable to">
                {#each cables.wired as other (other.id)}<option value="-{other.id}">{other.name}</option>{/each}
              </optgroup>
            {/if}
          </select>
        </span>
      </label>
      {#if data.note || noting}
        <label class="field">
          Note for the agent
          <textarea
            rows="2"
            placeholder="e.g. run with the new pricing flag on"
            value={data.note}
            {@attach grow}
            oninput={ev => {
              grow(ev.currentTarget);
              board.set(id, { note: ev.currentTarget.value });
            }}
            onblur={() => (noting = false)}
          ></textarea>
        </label>
      {:else}
        <button class="note-toggle" type="button" onclick={() => (noting = true)}>Add a note for the agent</button>
      {/if}
    </div>
  {/if}
  {#if where}<p class="where nodrag" data-on={up ?? 'other'}>{where}</p>{/if}
  {#if steps.length}
    <button class="progress nodrag" type="button" data-tone={tone} aria-expanded={open} onclick={() => (open = !open)}>
      <span class="marks">
        {#each steps as step, at (at)}<i data-state={step.state} title={step.label}></i>{/each}
      </span>
      <span class="text">{said}</span>
      <span class="chev">{open ? 'Hide' : 'Details'}</span>
    </button>
    {#if failed?.detail && !open}<p class="why nodrag">{failed.detail}</p>{/if}
    {#if open}
      <ul class="steps nodrag nopan">
        {#each steps as step, at (at)}
          <li class="step" data-state={step.state}>
            <span class="mark" aria-hidden="true"
              >{#if step.state === 'done'}<Icon of={Check} size={11} />{:else if step.state === 'failed'}!{/if}</span
            >
            <span class="what">{step.label}</span>
            {#if step.detail}<span class="detail">{step.detail}</span>{/if}
            {#if step.copy}
              <Command command={step.copy} />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if failed}
    <div class="acts nodrag">
      <!-- The failure goes to the agent with the app and step; it says what it would change and asks before it acts. -->
      <button
        class="act fix"
        type="button"
        disabled={asked}
        onclick={async () => {
          asked = await runs.askToFix(id, `${failed.label}${failed.detail ? `: ${failed.detail}` : ''}`);
        }}>{asked ? 'Sent to the agent' : 'Ask the agent to fix'}</button
      >
    </div>
  {/if}
  {#if calls.length}
    <div class="calls nodrag nopan">
      <span class="calls-label">Calls {board.env.toUpperCase()}</span>
      {#each calls as other (other.id)}
        {@const onBoard = board.cards.some(node => node.id === other.id)}
        {@const can = onBoard || other.cloned}
        <button
          class="chip"
          type="button"
          disabled={!can}
          title="{other.name} stays on deployed {board.env.toUpperCase()}.{can
            ? ` Click to ${onBoard ? 'wire it to your local copy' : 'run it locally too and wire it'}.`
            : ' It is not cloned on this Mac.'}"
          onclick={() => {
            board.callLocally(id, other.id);
          }}>{short(other.name)}</button
        >
      {/each}
    </div>
  {/if}
  <!-- The one anchor Svelte Flow needs to draw this card's cables; the ports below are ours. -->
  <Handle type="source" position={Position.Top} isConnectable={false} class="anchor" />
  {#each SIDES as side (side)}
    <button
      class="port {side} nodrag nopan"
      class:on={lit(side)}
      aria-label="Draw a cable from the {side} of {data.name}"
      title="Drag a cable to an app this one should call locally"
      tabindex="-1"
      onpointerdown={ev => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        wiring.start(id, side);
      }}
    ></button>
  {/each}
</article>

<style>
  .card {
    position: relative;
    width: max-content;
    min-width: 260px;
    max-width: 380px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink);
    font: 14px/1.4 var(--sans);
    user-select: none;
  }
  .card.selected,
  :global(.svelte-flow__node:focus-visible) .card {
    outline: 2px solid var(--cable);
    /* On the border itself: one frame, not a ring around a frame. */
    outline-offset: -1px;
  }
  .card.drop-ok {
    box-shadow: 0 0 0 3px var(--ok);
  }
  .card.drop-bad {
    box-shadow: 0 0 0 3px var(--bad);
  }
  /* Only the title sets a card's width: everything below it fits whatever width the title makes. */
  .body,
  .glance {
    contain: inline-size;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 6px 8px 6px 16px;
    border-bottom: 1px solid var(--line);
    cursor: grab;
  }
  .short header {
    border-bottom: 0;
  }
  .grip {
    display: grid;
    margin-left: -6px;
    fill: var(--muted);
    opacity: 0.6;
  }
  .kind {
    flex: none;
    margin-left: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    font: 600 12px/1.5 var(--sans);
    white-space: nowrap;
    color: var(--kind);
    background: color-mix(in oklab, var(--kind) 14%, transparent);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 15px;
    line-height: 1.2;
    text-wrap: balance;
    overflow-wrap: break-word;
  }
  /* A word is never broken: what follows the name goes to the next line instead. */
  .short header {
    flex-wrap: wrap;
  }
  .short .name {
    min-width: min-content;
    font-size: 22px;
  }
  .tools {
    display: flex;
    gap: 1px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel);
    box-shadow: var(--lift);
  }
  .tools.reading .remove {
    display: none;
  }
  .tools button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .tools button:hover,
  .tools button:focus-visible {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  .tools :is(.remove, .stop):hover {
    color: var(--bad);
  }
  .tools .fill {
    fill: currentColor;
    stroke: none;
  }
  .body {
    display: grid;
    gap: 8px;
    padding: 10px 14px 14px 16px;
    cursor: default;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .field {
    display: grid;
    gap: 3px;
    font-size: 12px;
    color: var(--muted);
  }
  .combo {
    position: relative;
    display: block;
  }
  .combo::after {
    content: '';
    position: absolute;
    right: 11px;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
  }
  select {
    width: 100%;
    height: 30px;
    padding: 0 26px 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
    appearance: none;
    cursor: pointer;
    text-overflow: ellipsis;
  }
  select.mono {
    font: 12px var(--mono);
  }
  .seg {
    height: 30px;
  }
  .seg label {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 0 10px;
    font-size: 12.5px;
  }
  .toggle {
    width: fit-content;
    min-height: 30px;
    color: var(--ink);
    font-size: 13px;
  }
  .live {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--bad);
  }
  .live[data-on='true'] {
    background: var(--ok);
  }
  .where {
    contain: inline-size;
    margin: 0;
    padding: 0 14px 10px 16px;
    color: var(--muted);
    font-size: 12px;
    user-select: text;
    cursor: auto;
  }
  .where[data-on='true'] {
    color: var(--ok);
  }
  .progress {
    contain: inline-size;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px 14px 9px 16px;
    border: 0;
    border-top: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: 600 12.5px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .progress:hover {
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .marks {
    display: flex;
    gap: 4px;
  }
  .marks i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--line);
  }
  .marks i[data-state='done'] {
    background: var(--ok);
  }
  .marks i[data-state='user'] {
    background: var(--warn);
  }
  .marks i[data-state='failed'] {
    background: var(--bad);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .progress[data-tone='user'] .text {
    color: var(--warn);
  }
  .progress[data-tone='failed'] .text {
    color: var(--bad);
  }
  .chev {
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
  }
  .why {
    contain: inline-size;
    display: -webkit-box;
    margin: -4px 0 0;
    padding: 0 14px 10px 16px;
    overflow: hidden;
    font-size: 12.5px;
    line-height: 1.4;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .steps {
    contain: inline-size;
    display: grid;
    gap: 7px;
    margin: 0;
    padding: 4px 14px 12px 16px;
    list-style: none;
    user-select: text;
    cursor: auto;
  }
  .step {
    display: grid;
    grid-template-columns: 18px 1fr;
    column-gap: 8px;
    font-size: 12.5px;
    line-height: 1.3;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--line);
    color: var(--on-accent);
    font-size: 12px;
    font-weight: 700;
  }
  .step[data-state='done'] .mark {
    background: var(--ok);
  }
  .step[data-state='user'] .mark {
    background: var(--warn);
  }
  .step[data-state='failed'] .mark {
    background: var(--bad);
  }
  .step[data-state='todo'] .mark {
    border: 2px solid var(--line);
    background: none;
  }
  .what {
    font-weight: 600;
  }
  .step[data-state='user'] .what::after {
    content: ' (you)';
    color: var(--warn);
    font-weight: 500;
  }
  .detail {
    grid-column: 2;
    color: var(--muted);
  }
  .step :global(.cmd) {
    grid-column: 2;
    margin-top: 4px;
  }
  .acts {
    contain: inline-size;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 14px 12px 16px;
    cursor: default;
  }
  .act {
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .act:hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
  }
  .act.fix {
    border-color: color-mix(in oklab, var(--bad) 45%, var(--line));
    background: color-mix(in oklab, var(--bad) 10%, transparent);
  }
  .act:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .short .act {
    font-size: 16px;
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--cable);
    font: 500 12px var(--sans);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .calls {
    contain: inline-size;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 10px 16px;
    border-top: 1px dashed var(--line);
    cursor: default;
  }
  .reading.far .calls {
    display: none;
  }
  .calls-label {
    margin-right: 2px;
    color: var(--muted);
    font-size: 12px;
  }
  .chip {
    max-width: 180px;
    min-height: 24px;
    padding: 3px 8px;
    overflow: hidden;
    border: 1px dashed color-mix(in oklab, var(--muted) 70%, transparent);
    border-radius: 999px;
    background: none;
    color: var(--ink);
    font: 500 12px var(--sans);
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    border-style: solid;
    border-color: var(--cable);
    color: var(--cable);
  }
  .chip:disabled {
    color: var(--muted);
    cursor: default;
  }
  /* The short card reads at a glance: larger, and nothing on it to edit or pull. */
  .short {
    min-width: 260px;
    max-width: 380px;
    padding-bottom: 4px;
  }
  .short header {
    min-height: 60px;
  }
  .short .port {
    display: none;
  }
  .short .progress {
    padding: 12px 16px;
    font-size: 21px;
  }
  .short .marks i {
    transform: scale(1.4);
  }
  .short .chev {
    font-size: 14px;
  }
  .short .where {
    font-size: 16px;
  }
  .short .why {
    font-size: 16px;
  }
  .short :is(.calls-label, .chip) {
    font-size: 15px;
  }
  .reading.far .progress {
    font-size: 24px;
  }
  .reading.far :is(.glance, .where, .chev) {
    display: none;
  }
  .glance .off {
    background: color-mix(in oklab, var(--warn) 14%, transparent);
    color: var(--warn);
    font: 600 15px var(--sans);
  }
  .note-toggle {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: 500 12.5px var(--sans);
    cursor: pointer;
  }
  .note-toggle::before {
    content: '+';
    font-size: 16px;
    line-height: 1;
  }
  .note-toggle:hover {
    color: var(--cable);
  }
  textarea {
    width: 100%;
    min-height: 52px;
    padding: 6px 8px;
    resize: none;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px/1.4 var(--sans);
  }
  textarea::placeholder {
    color: var(--muted);
  }
  :is(select, textarea, .remove, .note-toggle):focus-visible {
    outline: 2px solid var(--cable);
    outline-offset: 1px;
  }
  .glance {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0 16px 10px;
  }
  .glance span {
    padding: 2px 8px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--ink) 7%, transparent);
    font: 15px var(--mono);
    color: var(--muted);
  }
  .port {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    padding: 0;
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: var(--surface);
    opacity: 0;
    cursor: crosshair;
    transition: opacity 0.1s;
  }
  .card:hover .port,
  .card.wiring .port,
  .port.on {
    opacity: 1;
  }
  .port:hover {
    border-color: var(--cable);
  }
  /* On the card's outer edge, where its cables end: one pixel out from where the border's inside puts them. */
  .port.top {
    left: 50%;
    top: -1px;
  }
  .port.right {
    left: calc(100% + 1px);
    top: 50%;
  }
  .port.bottom {
    left: 50%;
    top: calc(100% + 1px);
  }
  .port.left {
    left: -1px;
    top: 50%;
  }
  .card :global(.anchor) {
    visibility: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .port {
      transition: none;
    }
  }
</style>
