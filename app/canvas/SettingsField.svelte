<script lang="ts">
  import Icon from './Icon.svelte';
  import Lock from '@lucide/svelte/icons/lock';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  // One field of the stack in a settings panel, edited the way it is best edited: picked where Koppler knows what it
  // can be, a row with a sentence where it is one of a list, else by its schema (text, a number, a switch, a group).
  // Each keeps its value through the panel, which checks it; a lock keeps it as it is.
  import { untrack } from 'svelte';
  import { parsePath, setAt } from '../src/core/stack-path.ts';
  import Checks from './Checks.svelte';
  import Chips from './Chips.svelte';
  import KindIcon from './KindIcon.svelte';
  import KindPick from './KindPick.svelte';
  import Pick from './Pick.svelte';
  import Self from './SettingsField.svelte';
  import {
    addressNote,
    child,
    controlOf,
    emptyFor,
    EMPTY,
    EXAMPLES,
    itemName,
    kindOf,
    label,
    NEEDS,
    needsFields,
    ROW_LISTS,
    rowOf,
    type Ctx,
    type NeedType,
    type Schema,
  } from './settings.ts';

  const {
    path,
    name,
    schema,
    value,
    ctx,
    required = false,
    depth = 0,
    drop,
    as,
    bare = false,
    open,
  }: {
    path: string;
    name: string;
    schema: Schema;
    value: unknown;
    ctx: Ctx;
    required?: boolean;
    depth?: number;
    /** Words for taking the value out, when that means more than removing it: "Use QA's". */
    drop?: string;
    /** The type of a need that holds nothing yet. */
    as?: string | undefined;
    /** Only the control: the row it sits in names it and holds its lock. */
    bare?: boolean;
    open?: boolean;
  } = $props();
  const kind = $derived(kindOf(schema, value));
  const nested = $derived(kind === 'group' || kind === 'table' || kind === 'list');
  const choice = $derived(nested ? null : ctx.options(path));
  const control = $derived(controlOf(path, schema, value, choice));
  const locked = $derived(ctx.locked(path));
  const id = $props.id();
  let error = $state('');
  // What the last Save found wrong here wins over nothing; a refusal of this field's own edit wins over both.
  const shown = $derived(error || ctx.problem?.(path) || '');
  const save = async (next: unknown) => {
    error = (await ctx.save(path, next)) ?? '';
  };
  const object = $derived(
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
  );
  const list = $derived(Array.isArray(value) ? (value as unknown[]) : []);
  const row = $derived(rowOf(path, value, ctx.stack(), as));
  // Fields the schema or the row does not name are shown too: nothing in the stack is hidden.
  const named = $derived(row ? [...row.fields, ...(row.own ?? [])] : Object.keys(schema.properties ?? {}));
  const extra = $derived(Object.keys(object).filter(key => !named.includes(key)));
  const fields = $derived(row ? row.fields : Object.keys(schema.properties ?? {}));
  const inline = $derived(row?.inline && !extra.length ? row.inline : undefined);
  const called = $derived(row ? [row.label, row.say].filter(Boolean).join(': ') : name);
  const json = (shown: unknown) => (shown === undefined ? '' : JSON.stringify(shown, null, 2));
  const offered = $derived((ctx.keys(path) ?? []).filter(key => !Object.hasOwn(object, key)));
  const hint = $derived(schema.description ?? '');
  const address = $derived(control === 'address' ? addressNote(value) : {});
  const rows = $derived(ROW_LISTS.exec(path)?.[1]);
  const text = (one: unknown) => (typeof one === 'string' ? one : '');
  const strings = $derived(list.filter(one => typeof one === 'string'));
  const stack = $derived(
    ctx.stack() as {
      envs?: string[];
      queues?: Record<string, { name?: string }>;
      apps?: Record<string, { name?: string; outside?: unknown }>;
    } | null,
  );
  const signIns = $derived(Object.keys((ctx.stack() as { signIns?: object } | null)?.signIns ?? {}).length);
  let newKey = $state('');
  // A new item is filled in here first, then kept as a whole.
  let draft = $state<Record<string, unknown> | null>(null);
  let draftAs = $state<string>();
  let choosing = $state(false);
  // Open or closed as it starts, then as it is left by hand, whatever is edited inside.
  let unfolded = $state(untrack(() => open ?? (!row && value !== undefined && depth < 2)));
  const draftCtx = $derived<Ctx>({
    ...ctx,
    save: (at: string, next: unknown) => {
      const inside = parsePath(at.slice(child(path, list.length).length).replace(/^\./, ''));
      if (!('error' in inside)) draft = setAt(draft, inside, next) as Record<string, unknown>;
      return Promise.resolve(null);
    },
    locked: () => false,
    fresh: true,
  });
  const start = (type?: NeedType) => {
    choosing = false;
    draftAs = type?.id;
    draft = { ...type?.start };
  };
  const add = async () => {
    if (kind === 'list') {
      if (rows === 'prereqs') choosing = true;
      else if (rows || needsFields(schema.items)) start();
      else error = (await ctx.save(child(path, list.length), emptyFor(schema.items))) ?? '';
      return;
    }
    const key = newKey.trim();
    if (!key) return;
    error = (await ctx.save(child(path, key), emptyFor(schema.additionalProperties))) ?? '';
    if (!error) newKey = '';
  };
  const ADD: Record<string, string> = {
    prereqs: 'Add a need',
    secrets: 'Add a secret',
    localChanges: 'Add a change',
    consumes: 'Add an app it calls…',
  };
</script>

<!-- eslint-disable @typescript-eslint/no-confusing-void-expression -- {@render} of a snippet returns nothing -->
{#snippet acts()}
  <span class="acts" class:fresh={ctx.fresh}>
    {#if drop && !locked}
      <button class="words" type="button" onclick={() => void save(undefined)}>{drop}</button>
    {:else if value !== undefined && !required && !locked}
      <button
        class="icon"
        type="button"
        aria-label="Remove {called}"
        title="Remove"
        onclick={() => void save(undefined)}
      >
        <Icon of={X} size={11} />
      </button>
    {/if}
    <button
      class="icon lock"
      class:on={locked}
      type="button"
      aria-pressed={locked}
      aria-label="{locked ? 'Unlock' : 'Lock'} {called}"
      title={locked ? 'Locked: nothing changes it. Click to unlock' : 'Lock: keep it as it is, for you and the agent'}
      onclick={() => {
        ctx.lock(path, !locked);
      }}
    >
      <Icon of={locked ? Lock : LockOpen} size={12} />
    </button>
  </span>
{/snippet}

{#snippet inside()}
  {#if kind === 'group'}
    {#each fields as key (key)}
      <Self
        path={child(path, key)}
        name={label(key, path === '')}
        schema={schema.properties?.[key] ?? {}}
        value={object[key]}
        {ctx}
        required={!!schema.required?.includes(key)}
        depth={depth + 1}
      />
    {/each}
    {#each extra as key (key)}
      <Self
        path={child(path, key)}
        name={label(key)}
        schema={schema.properties?.[key] ?? {}}
        value={object[key]}
        {ctx}
        depth={depth + 1}
      />
    {/each}
  {:else if kind === 'table'}
    {#each Object.keys(object) as key (key)}
      <Self
        path={child(path, key)}
        name={key}
        schema={schema.additionalProperties as Schema}
        value={object[key]}
        {ctx}
        depth={depth + 1}
      />
    {/each}
    {#if rows && !Object.keys(object).length}<span class="none">{EMPTY[rows]}</span>{/if}
    <span class="add">
      {#if ctx.keys(path)}
        <select aria-label="Add to {name}" bind:value={newKey}>
          <option value="">{(rows && ADD[rows]) || 'Add…'}</option>
          {#each offered as key (key)}
            <option value={key}>{rowOf(child(path, key), {}, ctx.stack())?.label ?? key}</option>
          {/each}
        </select>
      {:else}
        <input aria-label="New key in {name}" placeholder="New key" bind:value={newKey} />
      {/if}
      <button type="button" disabled={!newKey.trim()} onclick={() => void add()}>Add</button>
    </span>
  {:else}
    <!-- Drawn anew when one is added or taken out: what was open belongs to an item, not to its place. -->
    {#key list.length}
      {#each list as item, at (at)}
        <Self
          path={child(path, at)}
          name={itemName(item, `${name} ${String(at + 1)}`)}
          schema={schema.items ?? {}}
          value={item}
          {ctx}
          depth={depth + 1}
        />
      {/each}
    {/key}
    {#if rows && !list.length && !draft && !choosing}<span class="none">{EMPTY[rows]}</span>{/if}
    {#if draft}
      <div class="draft" role="group" aria-label="New in {name}">
        <Self
          path={child(path, list.length)}
          name="New"
          schema={schema.items ?? {}}
          value={draft}
          ctx={draftCtx}
          as={draftAs}
          required
          open
          depth={depth + 1}
        />
        <span class="add">
          <button
            type="button"
            class="go"
            onclick={async () => {
              error = (await ctx.save(child(path, list.length), draft)) ?? '';
              if (!error) draft = null;
            }}>Keep</button
          >
          <button type="button" onclick={() => (draft = null)}>Cancel</button>
        </span>
      </div>
    {:else if choosing}
      <div class="types" role="group" aria-label="What does it need?">
        {#each NEEDS as type (type.id)}
          {@const none = type.id === 'signIn' && !signIns}
          <button type="button" disabled={none} onclick={() => start(type)}>
            <span class="glyph"><Icon of={type.icon} size={15} /></span>
            <span class="what">{type.label}</span>
            <span class="about">{none ? 'This stack defines none yet' : type.about}</span>
          </button>
        {/each}
        <span class="add"><button type="button" onclick={() => (choosing = false)}>Cancel</button></span>
      </div>
    {:else}
      <span class="add"><button type="button" onclick={() => void add()}>{(rows && ADD[rows]) || 'Add'}</button></span>
    {/if}
  {/if}
  {#if shown}<span class="error" role="alert">{shown}</span>{/if}
{/snippet}

{#if inline}
  <div class="field line" class:locked class:wide={depth > 1 || bare}>
    {#if depth <= 1}<span class="name" title={hint}>{name}</span>{/if}
    <fieldset class="parts" disabled={locked}>
      <legend class="sr">{called}</legend>
      {#each fields as key (key)}
        <span class="part" data-key={key}>
          <span class="word">{inline[key]}</span>
          <Self
            path={child(path, key)}
            name={label(key)}
            schema={schema.properties?.[key] ?? {}}
            value={object[key]}
            {ctx}
            bare
            depth={depth + 1}
          />
        </span>
      {/each}
    </fieldset>
    {@render acts()}
    {#if shown}<span class="error" role="alert">{shown}</span>{/if}
  </div>
{:else if nested && !control && depth === 0}
  <fieldset class="top" disabled={locked}>
    <legend class="sr">{name}</legend>
    <span class="row"><span class="name">Everything</span>{@render acts()}</span>
    {#if hint}<span class="about">{hint}</span>{/if}
    {@render inside()}
  </fieldset>
{:else if nested && !control}
  <!-- A group with nothing in it stays closed, and so does a row: what it holds is a click away. -->
  <details class="nest" class:rowed={!!row} bind:open={unfolded}>
    <summary title={hint}>
      <span class="chev"><Icon of={ChevronRight} size={10} /></span>
      {#if row?.kind}
        <KindIcon kind={row.kind} label="" />
      {:else if row?.icon}
        <span class="glyph"><Icon of={row.icon} size={15} /></span>
      {/if}
      {#if row}
        <span class="name"><span class="what">{row.label}</span><span class="say">{row.say}</span></span>
      {:else}
        <span class="name">{name}</span>
        {#if value === undefined}<span class="unset">Not set</span>{/if}
      {/if}
      {@render acts()}
    </summary>
    <fieldset disabled={locked}>
      <legend class="sr">{called}</legend>
      {#if hint && !row}<span class="about">{hint}</span>{/if}
      {@render inside()}
    </fieldset>
  </details>
{:else}
  <div class="field" class:locked class:bare>
    <label class="name" class:sr={bare} for={id} title={hint}>{name}</label>
    {#if control === 'kind' && choice}
      <KindPick {id} value={text(value)} options={choice.options} disabled={locked} onpick={next => void save(next)} />
    {:else if control === 'pick' && choice}
      <Pick
        {id}
        value={text(value)}
        options={choice.options}
        other={!!choice.other}
        {required}
        disabled={locked}
        placeholder={bare ? (EXAMPLES[path.split('.').at(-1) ?? ''] ?? name) : hint}
        onpick={next => void save(next)}
      />
    {:else if control === 'ordered' || control === 'chips'}
      <Chips
        value={strings}
        label={name}
        ordered={control === 'ordered'}
        first={control === 'ordered' ? 'runs by default' : ''}
        disabled={locked}
        onchange={(next: string[]) => void save(next.length || required || control === 'ordered' ? next : undefined)}
      />
    {:else if control === 'envs'}
      {@const envs = stack?.envs ?? []}
      <Checks
        options={envs.map(env => ({ value: env, label: env.toUpperCase() }))}
        picked={value === undefined ? envs.slice(1) : strings}
        label={name}
        disabled={locked}
        none="The stack has no environments yet."
        ontoggle={(env, on) => {
          const now = value === undefined ? envs.slice(1) : strings;
          void save(envs.filter(one => (one === env ? on : now.includes(one))));
        }}
      />
    {:else if control === 'apps'}
      {@const self = path.split('.')[1]}
      <Checks
        options={Object.entries(stack?.apps ?? {})
          .filter(([key, one]) => key !== self && !one.outside)
          .map(([key, one]) => ({ value: key, label: one.name ?? key }))}
        picked={strings}
        label={name}
        disabled={locked}
        none="The stack has no other apps."
        ontoggle={(app, on) => {
          const next = on ? [...strings, app] : strings.filter(one => one !== app);
          void save(next.length ? next : undefined);
        }}
      />
    {:else if control === 'queues'}
      <Checks
        options={Object.entries(stack?.queues ?? {}).map(([key, queue]) => ({ value: key, label: queue.name ?? key }))}
        picked={Object.keys(object)}
        label={name}
        disabled={locked}
        none="The stack has no queues yet: add them in the stack's settings."
        ontoggle={(queue, on) => {
          const { [queue]: was, ...rest } = object;
          void save(on ? { ...object, [queue]: was ?? {} } : Object.keys(rest).length ? rest : undefined);
        }}
      />
    {:else if kind === 'switch'}
      <input
        {id}
        type="checkbox"
        role="switch"
        disabled={locked}
        checked={value === true}
        onchange={ev => void save(ev.currentTarget.checked)}
      />
    {:else if kind === 'choice'}
      <select
        {id}
        disabled={locked}
        value={value ?? ''}
        onchange={ev => void save(ev.currentTarget.value || undefined)}
      >
        <option value="">Not set</option>
        {#each schema.enum ?? [] as one (one)}<option value={one}>{String(one)}</option>{/each}
      </select>
    {:else if kind === 'number'}
      <!-- Text, so it can also hold an expression such as {{orders-api.port}}. -->
      <input
        {id}
        inputmode="numeric"
        disabled={locked}
        placeholder={bare ? (EXAMPLES[path.split('.').at(-1) ?? ''] ?? name) : hint}
        value={typeof value === 'number' || typeof value === 'string' ? value : ''}
        onchange={ev => {
          const typed = ev.currentTarget.value.trim();
          void save(typed === '' ? undefined : Number.isFinite(Number(typed)) ? Number(typed) : typed);
        }}
      />
    {:else if kind === 'text' && !(typeof value === 'string' && (value.length > 60 || value.includes('\n')) && !bare)}
      <input
        {id}
        disabled={locked}
        inputmode={control === 'address' ? 'url' : undefined}
        spellcheck={control === 'address' ? false : undefined}
        aria-invalid={address.warn ? true : undefined}
        placeholder={bare ? (EXAMPLES[path.split('.').at(-1) ?? ''] ?? name) : hint}
        value={typeof value === 'string' ? value : ''}
        onchange={ev => void save(ev.currentTarget.value === '' ? undefined : ev.currentTarget.value)}
      />
    {:else if kind === 'text'}
      <textarea
        {id}
        rows="3"
        disabled={locked}
        placeholder={hint}
        value={typeof value === 'string' ? value : ''}
        onchange={ev => void save(ev.currentTarget.value === '' ? undefined : ev.currentTarget.value)}
      ></textarea>
    {:else}
      <textarea
        {id}
        class="mono"
        rows={Math.min(10, json(value).split('\n').length + 1)}
        disabled={locked}
        placeholder={hint || 'JSON'}
        value={json(value)}
        onchange={ev => {
          const text = ev.currentTarget.value.trim();
          if (!text) {
            void save(undefined);
            return;
          }
          try {
            void save(JSON.parse(text));
          } catch {
            // Not JSON: kept as the text it is.
            void save(text);
          }
        }}
      ></textarea>
    {/if}
    {#if !bare}{@render acts()}{/if}
    {#if address.warn}
      <span class="note warn">{address.warn}</span>
    {:else if address.note}
      <span class="note">{address.note}</span>
    {/if}
    {#if shown}<span class="error" role="alert">{shown}</span>{/if}
  </div>
{/if}

<style>
  .top,
  fieldset {
    display: grid;
    gap: 6px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .row,
  summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
  }
  .nest {
    min-width: 0;
    padding: 2px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .nest[open] {
    padding-bottom: 10px;
  }
  .nest[open] > summary {
    margin-bottom: 4px;
  }
  summary {
    cursor: pointer;
    list-style-position: outside;
  }
  .chev {
    display: grid;
    flex: none;
    color: var(--muted);
    margin-left: -2px;
    transition: rotate 0.12s;
  }
  .nest[open] > summary .chev {
    rotate: 90deg;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .unset {
    color: var(--muted);
    font-size: 12px;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  summary .name,
  .row .name {
    flex: 1;
  }
  .field {
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 10px;
    row-gap: 2px;
    min-width: 0;
  }
  .field .name {
    font-weight: 500;
  }
  .about {
    color: var(--muted);
    font-size: 12px;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
    min-width: 46px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .icon:hover {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  .words {
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .lock.on {
    color: var(--warn);
  }
  input:not([type='checkbox']),
  select,
  textarea {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
  input:not([type='checkbox']),
  select {
    height: 28px;
  }
  select {
    padding-right: 26px;
    appearance: none;
    background-image: var(--chevron);
    background-repeat: no-repeat;
    background-position: right 9px center;
  }
  input::placeholder,
  textarea::placeholder {
    color: color-mix(in oklab, var(--muted) 70%, transparent);
  }
  textarea {
    resize: vertical;
  }
  .mono {
    font: 12px/1.45 var(--mono);
  }
  input[type='checkbox'] {
    justify-self: start;
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--cable);
  }
  :disabled {
    cursor: not-allowed;
  }
  .locked input,
  .locked textarea,
  .locked select {
    opacity: 0.7;
  }
  .add {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }
  .add select,
  .add input {
    flex: 1;
  }
  .add button {
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .add .go {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
  .draft {
    display: grid;
    gap: 6px;
  }
  .error {
    grid-column: 2 / -1;
    color: var(--bad);
    font-size: 12px;
  }
  .glyph {
    display: grid;
    flex: none;
    color: var(--muted);
  }
  summary .name {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .what {
    flex: none;
    font-weight: 600;
  }
  .say {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acts.fresh {
    display: none;
  }
  .none {
    padding: 2px 0;
    color: var(--muted);
  }
  .note {
    grid-column: 2 / -1;
    color: var(--muted);
    font-size: 12px;
  }
  .note.warn {
    color: var(--warn);
  }
  .bare {
    display: block;
    flex: 1;
    min-width: 0;
  }
  .line {
    align-items: start;
  }
  .line > .name {
    line-height: 28px;
  }
  .line.wide {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .line.wide .error {
    grid-column: 1 / -1;
  }
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
  }
  .part {
    display: flex;
    flex: 1 1 150px;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .part[data-key='file'] {
    flex-basis: 100%;
  }
  .part[data-key='status'],
  .part[data-key='timeout'] {
    flex: 0 1 132px;
  }
  .word {
    flex: none;
    color: var(--muted);
  }
  .types {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .types > button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 2px 8px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
    text-align: left;
    cursor: pointer;
  }
  .types > button:hover:not(:disabled) {
    border-color: var(--cable);
  }
  .types > button:disabled {
    opacity: 0.6;
  }
  .types .about {
    grid-column: 2;
  }
  .types .add {
    grid-column: 1 / -1;
  }
</style>
