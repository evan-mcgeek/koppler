<script lang="ts">
  // One field of the stack in a settings panel, edited the way its schema says: text, a number, a switch, a choice, or a
  // group, list or table of fields. Each keeps its value through the panel, which checks it; a lock keeps it as it is.
  import Self from './SettingsField.svelte';
  import { child, emptyFor, itemName, kindOf, label, needsFields, type Ctx, type Schema } from './settings.ts';

  const {
    path,
    name,
    schema,
    value,
    ctx,
    required = false,
    depth = 0,
  }: {
    path: string;
    name: string;
    schema: Schema;
    value: unknown;
    ctx: Ctx;
    required?: boolean;
    depth?: number;
  } = $props();
  const kind = $derived(kindOf(schema, value));
  const locked = $derived(ctx.locked(path));
  const id = $props.id();
  let error = $state('');
  const save = async (next: unknown) => {
    error = (await ctx.save(path, next)) ?? '';
  };
  const object = $derived(
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
  );
  const list = $derived(Array.isArray(value) ? (value as unknown[]) : []);
  // Fields the schema does not name are shown too: nothing in the stack is hidden.
  const extra = $derived(
    Object.keys(object).filter(key => !schema.properties || !Object.hasOwn(schema.properties, key)),
  );
  const json = (shown: unknown) => (shown === undefined ? '' : JSON.stringify(shown, null, 2));
  const offered = $derived((ctx.keys(path) ?? []).filter(key => !Object.hasOwn(object, key)));
  const hint = $derived(schema.description ?? '');
  let newKey = $state('');
  // An item with fields it cannot do without is filled in here first, then kept as a whole.
  let draft = $state<Record<string, unknown> | null>(null);
  const draftCtx: Ctx = {
    save: (at, next) => {
      const key = at.slice(child(path, list.length).length).replace(/^\./, '');
      const rest = Object.entries(draft ?? {}).filter(([one]) => one !== key);
      draft = Object.fromEntries(next === undefined || next === '' ? rest : [...rest, [key, next]]);
      return Promise.resolve(null);
    },
    locked: () => false,
    lock: (at, on) => {
      ctx.lock(at, on);
    },
    keys: at => ctx.keys(at),
  };
  const add = async () => {
    if (kind === 'list') {
      if (needsFields(schema.items)) {
        draft = {};
        return;
      }
      error = (await ctx.save(child(path, list.length), emptyFor(schema.items))) ?? '';
      return;
    }
    const key = newKey.trim();
    if (!key) return;
    error = (await ctx.save(child(path, key), emptyFor(schema.additionalProperties))) ?? '';
    if (!error) newKey = '';
  };
</script>

<!-- eslint-disable @typescript-eslint/no-confusing-void-expression -- {@render} of a snippet returns nothing -->
{#snippet acts()}
  <span class="acts">
    {#if value !== undefined && !required && !locked}
      <button class="icon" type="button" aria-label="Remove {name}" title="Remove" onclick={() => void save(undefined)}>
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    {/if}
    <button
      class="icon lock"
      class:on={locked}
      type="button"
      aria-pressed={locked}
      aria-label="{locked ? 'Unlock' : 'Lock'} {name}"
      title={locked ? 'Locked: nothing changes it. Click to unlock' : 'Lock: keep it as it is, for you and the agent'}
      onclick={() => {
        ctx.lock(path, !locked);
      }}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d={locked ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7V5a2.5 2.5 0 0 1 4.8-1'} />
      </svg>
    </button>
  </span>
{/snippet}

{#snippet inside()}
  {#if kind === 'group'}
    {#each Object.entries(schema.properties ?? {}) as [key, inner] (key)}
      <Self
        path={child(path, key)}
        name={label(key, path === '')}
        schema={inner}
        value={object[key]}
        {ctx}
        required={!!schema.required?.includes(key)}
        depth={depth + 1}
      />
    {/each}
    {#each extra as key (key)}
      <Self path={child(path, key)} name={key} schema={{}} value={object[key]} {ctx} depth={depth + 1} />
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
    <span class="add">
      {#if ctx.keys(path)}
        <select aria-label="Add to {name}" bind:value={newKey}>
          <option value="">Add…</option>
          {#each offered as key (key)}<option value={key}>{key}</option>{/each}
        </select>
      {:else}
        <input aria-label="New key in {name}" placeholder="New key" bind:value={newKey} />
      {/if}
      <button type="button" disabled={!newKey.trim()} onclick={() => void add()}>Add</button>
    </span>
  {:else}
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
    {#if draft}
      <div class="draft" role="group" aria-label="New item in {name}">
        <Self
          path={child(path, list.length)}
          name="New"
          schema={schema.items ?? {}}
          value={draft}
          ctx={draftCtx}
          required
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
    {:else}
      <span class="add"><button type="button" onclick={() => void add()}>Add</button></span>
    {/if}
  {/if}
  {#if error}<span class="error" role="alert">{error}</span>{/if}
{/snippet}

{#if (kind === 'group' || kind === 'table' || kind === 'list') && depth === 0}
  <fieldset class="top" disabled={locked}>
    <legend class="sr">{name}</legend>
    <span class="row"><span class="name">Everything</span>{@render acts()}</span>
    {@render inside()}
  </fieldset>
{:else if kind === 'group' || kind === 'table' || kind === 'list'}
  <!-- A group with nothing in it stays closed: what it holds is a click away. -->
  <details class="nest" open={value !== undefined && depth < 2}>
    <summary title={hint}>
      <svg class="chev" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      <span class="name">{name}</span>
      {#if value === undefined}<span class="unset">Not set</span>{/if}
      {@render acts()}
    </summary>
    <fieldset disabled={locked}>
      <legend class="sr">{name}</legend>
      {#if hint}<span class="about">{hint}</span>{/if}
      {@render inside()}
    </fieldset>
  </details>
{:else}
  <div class="field" class:locked>
    <label class="name" for={id} title={hint}>{name}</label>
    {#if kind === 'switch'}
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
      <input
        {id}
        type="number"
        disabled={locked}
        placeholder={hint}
        value={value ?? ''}
        onchange={ev => void save(ev.currentTarget.value === '' ? undefined : Number(ev.currentTarget.value))}
      />
    {:else if kind === 'text' && !(typeof value === 'string' && (value.length > 60 || value.includes('\n')))}
      <input
        {id}
        disabled={locked}
        placeholder={hint}
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
    {@render acts()}
    {#if error}<span class="error" role="alert">{error}</span>{/if}
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
    flex: none;
    margin-left: -2px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.8;
    stroke-linecap: round;
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
  .icon svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
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
</style>
