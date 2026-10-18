<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Icon from './Icon.svelte';
  // Settings for one part of the stack (an app, a queue, an outside system, the whole stack), opened from the gear next
  // to it. Its tabs are numbered channels down the side, in plain words, starting with what it is; every field its
  // schema has is there. Edits are a draft until Save, which checks the whole stack and writes it at once; Discard drops
  // them. A lock keeps a field as it is, for the user and the agent.
  import { KINDS } from '../src/core/kinds.ts';
  import { SECRET_TYPES } from '../src/core/secret-types.ts';
  import { getAt, parsePath, setAt } from '../src/core/stack-path.ts';
  import EnvOverrides from './EnvOverrides.svelte';
  import SettingsField from './SettingsField.svelte';
  import { board } from './board.svelte.ts';
  import { post } from './data.ts';
  import { live } from './live.svelte.ts';
  import { runs } from './run.svelte.ts';
  import {
    APP_HEAD,
    APP_TABS,
    BY_KIND,
    changes,
    child,
    HOWS,
    KIND_FIELDS,
    label,
    lockedBy,
    OTHER_ABOUT,
    OUTSIDE_TABS,
    problemsByPath,
    rowOf,
    STACK_HEAD,
    STACK_TABS,
    within,
    type Choice,
    type Ctx,
    type Option,
    type Schema,
    type Tab,
  } from './settings.ts';

  let dialog = $state<HTMLDialogElement>();
  let title = $state('');
  let at = $state('');
  /** The stack as it is kept, and the draft the panel edits. */
  let stack = $state.raw<unknown>(null);
  let draft = $state.raw<unknown>(null);
  let schema = $state.raw<Schema | null>(null);
  let locks = $state<string[]>([]);
  let problems = $state(new Map<string, string>());
  let tab = $state(0);
  let saving = $state(false);
  let leaving = $state(false);
  let saved = $state(false);
  let changed = false;
  let asked = $state(false);
  /** What this machine offers to pick from: AWS profile names, and what the app's clone holds. */
  interface Choices {
    awsProfiles: string[];
    files: string[];
    profiles: Record<string, string[]>;
    scripts: Record<string, string[]>;
  }
  const NO_CHOICES: Choices = { awsProfiles: [], files: [], profiles: {}, scripts: {} };
  let choices = $state(NO_CHOICES);

  const parts = (path: string) => {
    const parsed = parsePath(path);
    return 'error' in parsed ? [] : parsed;
  };
  /** The schema of the field at a path, walked down from the stack's. */
  const schemaAt = (root: Schema, path: string): Schema => {
    let here: Schema = root;
    for (const part of path ? parts(path) : []) {
      if (typeof part === 'number') here = here.items ?? {};
      else
        here =
          here.properties?.[part] ?? (typeof here.additionalProperties === 'object' ? here.additionalProperties : {});
    }
    return here;
  };
  const shape = $derived(schema ? schemaAt(schema, at) : {});
  const value = $derived((at ? getAt(draft, parts(at)) : draft) as Record<string, unknown> | undefined);
  const app = $derived(/^apps\.[a-z0-9-]+$/.test(at) ? at.slice(5) : null);
  const outside = $derived(!!app && !!value?.['outside']);
  // What it is first, then tabs; a part with no tabs of its own (a queue) shows all its fields in one.
  const head = $derived(app ? APP_HEAD : at ? [] : STACK_HEAD);
  const tabs = $derived.by((): Tab[] => {
    const identity: Tab = {
      name: 'Identity',
      about: app ? 'What it is called, and where its code is' : 'What the stack is called',
      keys: head,
    };
    const own = app ? [identity, ...(outside ? OUTSIDE_TABS : APP_TABS)] : at ? [] : [identity, ...STACK_TABS];
    const named = new Set([...head, ...own.flatMap(one => one.keys)]);
    const rest = [...Object.keys(shape.properties ?? {}), ...Object.keys(value ?? {})].filter(key => !named.has(key));
    const other = [...new Set(rest)];
    // One row of a list (a need): only the fields of its type, and any others it already has.
    const row = at ? rowOf(at, value, draft) : undefined;
    if (row) return [{ name: 'Settings', keys: [...new Set([...row.fields, ...Object.keys(value ?? {})])] }];
    if (!own.length) return [{ name: 'Settings', keys: other }];
    return other.length ? [...own, { name: 'Other', about: OTHER_ABOUT, keys: other }] : own;
  });
  const shown = $derived(tabs[Math.min(tab, tabs.length - 1)]);
  const count = $derived(changes(stack, draft));
  const valueAt = (from: unknown, path: string) => (path ? getAt(from, parts(path)) : from);
  const changedAt = (path: string) => changes(valueAt(stack, path), valueAt(draft, path)) > 0;
  const changedIn = (keys: string[]) => keys.filter(key => changedAt(child(at, key)));
  /** The fields with a change, by name. */
  const named = $derived.by(() => {
    const kept = (valueAt(stack, at) ?? {}) as Record<string, unknown>;
    return changedIn([...new Set([...Object.keys(kept), ...Object.keys(value ?? {})])]).map(key => label(key, !at));
  });
  const wrongIn = (keys: string[]) =>
    [...problems.keys()].filter(place => keys.some(key => within(place, child(at, key)))).length;
  const kindSaid = $derived.by(() => {
    const kind = app && typeof value?.['kind'] === 'string' ? value['kind'] : '';
    return (Object.hasOwn(KINDS, kind) ? KINDS[kind]?.label : null) ?? kind;
  });
  const slug = $derived(app && typeof value?.['slug'] === 'string' ? value['slug'] : '');

  export async function open(what: { title: string; path: string }): Promise<void> {
    title = what.title;
    at = what.path;
    changed = false;
    asked = false;
    saved = false;
    leaving = false;
    // Past what it is, to the first tab of settings.
    tab = 1;
    problems = new Map();
    locks = live.status?.locks ?? [];
    const id = /^apps\.([a-z0-9-]+)$/.exec(what.path)?.[1] ?? '';
    const [loaded, registry, here] = await Promise.all([
      schema
        ? Promise.resolve(schema)
        : fetch('data/stack-schema.json').then(answer => answer.json() as Promise<Schema>),
      fetch('data/registry.json').then(answer => answer.json() as Promise<Record<string, unknown>>),
      fetch(`data/choices.json?app=${id}`)
        .then(answer => answer.json() as Promise<Choices>)
        .catch(() => NO_CHOICES),
    ]);
    choices = { ...NO_CHOICES, ...here };
    schema = loaded;
    const { source: _source, found: _found, ...own } = registry;
    stack = own;
    draft = JSON.parse(JSON.stringify(own)) as unknown;
    dialog?.showModal();
  }

  const plain = (values: string[]): Option[] => values.map(one => ({ value: one, label: one }));
  const typed = (values: string[], other = true): Choice => ({ options: plain(values), other });
  const filesLike = (pattern: RegExp) => choices.files.filter(file => pattern.test(file));
  /** What the field at a path is picked from, by the key it ends in. */
  const optionsFor = (path: string): Choice | null => {
    const key = /(?:^|\.)([A-Za-z]+)$/.exec(path)?.[1] ?? '';
    const all = (draft ?? {}) as { kinds?: Record<string, { label?: string }>; signIns?: Record<string, unknown> };
    const mine = value ?? {};
    if (key === 'kind' && /^apps\.[a-z0-9-]+\.kind$/.test(path))
      return {
        options: [
          ...Object.entries(KINDS).map(([id, kind]) => ({ value: id, label: kind.label, kind: id })),
          ...Object.entries(all.kinds ?? {})
            .filter(([id]) => !Object.hasOwn(KINDS, id))
            .map(([id, kind]) => ({ value: id, label: kind.label ?? id, kind: id })),
        ],
      };
    if (key === 'sso') return typed(choices.awsProfiles);
    if (key === 'signIn') return typed(Object.keys(all.signIns ?? {}), false);
    if (key === 'how' && /consumes/.test(path)) return { options: HOWS };
    if (key === 'type' && /secrets\[\d+\]\.type$/.test(path))
      return { options: SECRET_TYPES.map(type => ({ value: type, label: label(type) })), other: true };
    if (!app) return null;
    if (key === 'project' && !/lambda\.project$/.test(path)) {
      // dotnet takes the project's folder as well as its file.
      const found = filesLike(/\.(cs|fs|vb)proj$/);
      return typed([...new Set(found.map(file => file.split('/').slice(0, -1).join('/') || '.')), ...found]);
    }
    if (key === 'launchSettings') return typed(Object.keys(choices.profiles));
    if (key === 'baseProfile') {
      const file = typeof mine['launchSettings'] === 'string' ? mine['launchSettings'] : '';
      const found = choices.profiles[file] ?? [...new Set(Object.values(choices.profiles).flat())];
      return typed(found);
    }
    if (key === 'script') return typed(choices.scripts['package.json'] ?? Object.values(choices.scripts)[0] ?? []);
    if (key === 'defineFile')
      return typed(filesLike(/\.(json|env)$/).filter(file => !/(^|\/)package(-lock)?\.json$/.test(file)));
    if (key === 'template') return typed(filesLike(/\.ya?ml$/));
    if (key === 'file') return typed(choices.files);
    return null;
  };

  const ctx: Ctx = {
    // An edit changes the draft only; Save checks it all.
    save: (path, next) => {
      draft = setAt(draft, parts(path), next);
      saved = false;
      if (problems.has(path)) problems = new Map([...problems].filter(([place]) => place !== path));
      return Promise.resolve(null);
    },
    locked: path => lockedBy(locks, path),
    lock: (path, on) => {
      void post('stack-lock', { path, on }).then(said => {
        if (!('error' in said)) locks = on ? [...locks, path] : locks.filter(one => one !== path);
      });
    },
    keys: path => {
      if (/(^|\.)consumes$/.test(path))
        return board.apps.map(one => one.id).filter(id => !path.startsWith(`apps.${id}.`));
      if (/(^|\.)(envs|sam\.envs)$/.test(path)) return board.envs;
      if (/(^|\.)(publishes|reads)$/.test(path))
        return Object.keys((getAt(draft, ['queues']) as Record<string, unknown> | undefined) ?? {});
      return null;
    },
    problem: path => problems.get(path),
    changed: changedAt,
    options: optionsFor,
    stack: () => draft,
  };
  const save = async () => {
    saving = true;
    const said = await post<{ ok?: boolean; problems?: string[] }>('stack-save', { stack: draft });
    saving = false;
    if ('error' in said) {
      const found = (said as { problems?: string[] }).problems ?? [];
      problems = found.length ? problemsByPath(found) : new Map([['', said.error]]);
      // The first tab with something wrong comes to the front.
      const first = tabs.findIndex(one => wrongIn(one.keys));
      if (first >= 0) tab = first;
      return;
    }
    stack = JSON.parse(JSON.stringify(draft)) as unknown;
    problems = new Map();
    saved = true;
    changed = true;
  };
  const discard = () => {
    draft = JSON.parse(JSON.stringify(stack)) as unknown;
    problems = new Map();
  };
  const close = () => {
    if (count && !leaving) {
      leaving = true;
      return;
    }
    dialog?.close();
    // What the board shows comes from the stack: it is read again with what was saved.
    if (changed) void board.reload();
  };
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="settings-title"
  oncancel={ev => {
    ev.preventDefault();
    close();
  }}
  onclick={ev => {
    // A click outside the panel lands on the dialog itself (its backdrop): it closes, or asks first with changes.
    if (ev.target === dialog) close();
  }}
>
  <header>
    {#if app && live.up(app)}<span class="led" title="Running"></span>{/if}
    <div class="who">
      <h2 id="settings-title">{title}</h2>
      {#if kindSaid || slug}
        <span class="sub">
          {#if kindSaid}<span class="tag">{kindSaid}</span>{/if}
          {#if slug}<span class="slug">{slug}</span>{/if}
        </span>
      {/if}
    </div>
    {#if app && !outside}
      <button
        type="button"
        class="ask"
        disabled={asked}
        title="It reads the repo, says what it would set, and asks you first. Locked fields stay as they are."
        onclick={async () => {
          asked = await runs.askFill(
            app,
            Object.keys(shape.properties ?? {}).filter(key => value?.[key] === undefined && key !== 'outside'),
            locks.filter(one => one.startsWith(`apps.${app}.`)),
          );
        }}>{asked ? 'Asked the agent' : 'Ask the agent to fill in'}</button
      >
    {/if}
    <button class="x" type="button" aria-label="Close" onclick={close}>×</button>
  </header>
  {#if schema && draft}
    <div class="main" class:single={tabs.length < 2}>
      {#if tabs.length > 1}
        <div class="tabs" role="tablist" aria-orientation="vertical" aria-label="{title} settings">
          {#each tabs as one, index (one.name)}
            {@const wrong = wrongIn(one.keys)}
            {@const edited = changedIn(one.keys).length}
            <button
              type="button"
              role="tab"
              aria-selected={shown === one}
              class:wrong={wrong > 0}
              onclick={() => (tab = index)}
              ><span class="marker" aria-hidden="true"></span>{one.name}{#if wrong}<span class="mark bad"
                  >{wrong} to fix</span
                >{:else if edited}<span class="mark">{edited} {edited === 1 ? 'change' : 'changes'}</span>{/if}</button
            >
          {/each}
        </div>
      {/if}
      <div class="body" role="tabpanel" aria-label={shown?.name}>
        {#if tabs.length > 1 && shown}
          <div class="sec">
            <span class="title">{shown.name}</span>{#if shown.about}<span class="about">{shown.about}</span>{/if}
          </div>
        {/if}
        {#if shown?.view === 'envs' && app && value}
          <EnvOverrides path={at} app={value} schema={shape} envs={board.envs} {ctx} />
        {:else if shown?.view === 'apps'}
          <ul class="apps">
            {#each Object.entries((value?.['apps'] ?? {}) as Record<string, { name?: string; kind?: string }>) as [id, one] (id)}
              <li>
                <span class="name">{one.name ?? id}</span>
                <span class="kind"
                  >{(Object.hasOwn(KINDS, one.kind ?? '') ? KINDS[one.kind ?? '']?.label : null) ??
                    one.kind ??
                    ''}</span
                >
                <button
                  type="button"
                  disabled={count > 0}
                  title={count ? 'Save or discard your changes first' : undefined}
                  onclick={() => void open({ title: one.name ?? id, path: `apps.${id}` })}>Settings</button
                >
              </li>
            {/each}
          </ul>
        {:else if shown}
          {@const kind = typeof value?.['kind'] === 'string' ? value['kind'] : ''}
          {@const mine = BY_KIND[kind] ?? []}
          {@const others = shown.keys.filter(
            key => KIND_FIELDS.includes(key) && !mine.includes(key) && value?.[key] === undefined,
          )}
          {#each shown.keys.filter(key => !others.includes(key)) as key (key)}
            <SettingsField
              path={child(at, key)}
              name={label(key, !at)}
              schema={shape.properties?.[key] ?? {}}
              value={value?.[key]}
              {ctx}
              required={!!shape.required?.includes(key)}
              depth={shown.keys.length === 1 ? 0 : 1}
            />
          {/each}
          {#if others.length}
            <!-- Fields for how other kinds of app start: not this one's, but nothing is hidden. -->
            <details class="others">
              <summary
                ><span class="chev"><Icon of={ChevronRight} size={10} /></span>Fields for other kinds of app</summary
              >
              {#each others as key (key)}
                <SettingsField
                  path={child(at, key)}
                  name={label(key)}
                  schema={shape.properties?.[key] ?? {}}
                  value={value?.[key]}
                  {ctx}
                  depth={1}
                />
              {/each}
            </details>
          {/if}
        {/if}
      </div>
    </div>
    <footer class:dirty={count > 0}>
      {#if leaving && count}
        <span class="say" role="alert">Close without saving {count} {count === 1 ? 'change' : 'changes'}?</span>
        <button type="button" onclick={() => (leaving = false)}>Keep editing</button>
        <button
          type="button"
          class="bad"
          onclick={() => {
            discard();
            close();
          }}>Discard and close</button
        >
      {:else}
        <span class="say" role="status">
          {#if problems.size}
            {problems.get('') ?? `${String(problems.size)} to fix before it can be saved`}
          {:else if count}
            {count} {count === 1 ? 'change' : 'changes'}{named.length ? ` · ${named.join(', ')}` : ''}
          {:else if saved}
            Saved
          {:else}
            No changes
          {/if}
        </span>
        <button type="button" disabled={!count || saving} onclick={discard}>Discard</button>
        <button type="button" class="go" disabled={!count || saving} onclick={() => void save()}
          >{saving ? 'Saving…' : 'Save'}</button
        >
      {/if}
    </footer>
  {/if}
</dialog>

<style>
  dialog {
    position: fixed;
    inset: 0 0 0 auto;
    width: min(640px, 100vw);
    max-width: none;
    height: 100vh;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--line-strong);
    background: var(--panel);
    color: var(--ink);
    font: 14px/1.4 var(--sans);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 40%, transparent);
  }
  .tag {
    padding: 1px 4px;
    border: 1px solid var(--line-strong);
    color: var(--ink-muted);
    font: 500 10px/1.3 var(--mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .slug {
    color: var(--ink-muted);
    font: 12px var(--mono);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--line);
  }
  .led {
    flex: none;
    width: 7px;
    height: 7px;
    background: var(--local);
  }
  .who {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  h2 {
    margin: 0;
    overflow: hidden;
    font: 600 20px var(--display);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
    overflow: hidden;
    white-space: nowrap;
  }
  header button,
  footer button,
  .apps button {
    padding: 8px 14px;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  header button:hover:not(:disabled),
  footer button:hover:not(:disabled),
  .apps button:hover:not(:disabled) {
    border-color: var(--ink);
  }
  .ask {
    border-style: dashed;
  }
  .ask:disabled {
    color: var(--ink-muted);
    cursor: default;
  }
  .x {
    padding: 8px 10px;
  }
  .main {
    display: grid;
    flex: 1;
    grid-template-columns: 196px minmax(0, 1fr);
    min-height: 0;
  }
  .main.single {
    grid-template-columns: minmax(0, 1fr);
  }
  .tabs {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-right: 1px solid var(--line);
  }
  .tabs button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: 400 13px var(--sans);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .tabs button:hover {
    background: color-mix(in oklab, var(--ink) 5%, transparent);
  }
  .tabs button[aria-selected='true'] {
    background: var(--desk);
    box-shadow: inset 2px 0 0 var(--ink);
  }
  .tabs button:focus-visible {
    outline-offset: -2px;
  }
  /* A square that says what is there: filled for the open section, amber where something needs you. */
  .marker {
    flex: none;
    width: 6px;
    height: 6px;
    border: 1px solid var(--line-strong);
  }
  [aria-selected='true'] .marker {
    border-color: var(--ink);
    background: var(--ink);
  }
  .wrong .marker {
    border-color: var(--warn);
    background: var(--warn);
  }
  .mark {
    margin-left: auto;
    font: 11px var(--mono);
  }
  .mark.bad {
    color: var(--warn);
    font: 12px var(--sans);
  }
  .body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-y: auto;
    padding-bottom: 20px;
  }
  .sec {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 14px 20px 8px;
    border-bottom: 1px solid var(--line);
  }
  .sec .title {
    font: 600 13px var(--sans);
    flex: none;
    color: var(--ink);
  }
  .about {
    min-width: 0;
    color: var(--ink-muted);
    font-size: 12px;
  }
  /* Each field is a row between hairlines; a fold sits in the gutter. */
  .body > :global(.field),
  .body > :global(fieldset.top) {
    padding: 12px 20px;
    border-bottom: 1px solid var(--line);
  }
  .body > :global(details),
  .body > :global(section),
  .body > :global(.apps),
  .body > :global(p),
  .others {
    margin: 10px 20px 0;
  }
  .others {
    display: grid;
    gap: 6px;
    color: var(--ink-muted);
  }
  .others[open] {
    color: var(--ink);
  }
  .others summary {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-muted);
    font-weight: 600;
    list-style: none;
    cursor: pointer;
  }
  .others summary::-webkit-details-marker {
    display: none;
  }
  .chev {
    display: grid;
    transition: rotate 0.12s;
  }
  .others[open] .chev {
    rotate: 90deg;
  }
  .apps {
    display: grid;
    padding: 0;
    list-style: none;
  }
  .apps li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .apps .name {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .apps .kind {
    color: var(--ink-muted);
    font: 500 10px var(--mono);
    text-transform: uppercase;
  }
  .apps button {
    padding: 4px 10px;
    font-size: 11px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }
  .say {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--ink-muted);
    font: 400 12px var(--sans);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty .say {
    color: var(--ink);
  }
  footer .go {
    border-color: var(--local);
    background: var(--local);
    color: var(--desk);
  }
  footer .bad {
    border-color: var(--prod);
    background: var(--prod);
    color: var(--ink);
  }
  footer button:disabled,
  .apps button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
