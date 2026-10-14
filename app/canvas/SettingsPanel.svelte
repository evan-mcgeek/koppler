<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Icon from './Icon.svelte';
  import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
  import X from '@lucide/svelte/icons/x';
  // Settings for one part of the stack (an app, a queue, an outside system, the whole stack), opened from the gear next
  // to it. What it is sits on top; the rest is in tabs, in plain words; every field its schema has is there. Edits are a
  // draft until Save, which checks the whole stack and writes it at once; Discard drops them. A lock keeps a field as it
  // is, for the user and the agent.
  import { KINDS } from '../src/core/kinds.ts';
  import { SECRET_TYPES } from '../src/core/secret-types.ts';
  import { getAt, parsePath, setAt } from '../src/core/stack-path.ts';
  import EnvOverrides from './EnvOverrides.svelte';
  import KindIcon from './KindIcon.svelte';
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
    OUTSIDE_TABS,
    problemsByPath,
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
  // What it is on top, then tabs; a part with no tabs of its own (a queue) shows all its fields in one.
  const head = $derived(app ? APP_HEAD : at ? [] : STACK_HEAD);
  const tabs = $derived.by((): Tab[] => {
    const own = app ? (outside ? OUTSIDE_TABS : APP_TABS) : at ? [] : STACK_TABS;
    const named = new Set([...head, ...own.flatMap(one => one.keys)]);
    const rest = [...Object.keys(shape.properties ?? {}), ...Object.keys(value ?? {})].filter(key => !named.has(key));
    const other = [...new Set(rest)];
    if (!own.length) return [{ name: 'Settings', keys: other }];
    return other.length ? [...own, { name: 'Other', keys: other }] : own;
  });
  const shown = $derived(tabs[Math.min(tab, tabs.length - 1)]);
  const count = $derived(changes(stack, draft));
  const wrongIn = (keys: string[]) =>
    [...problems.keys()].filter(place => keys.some(key => within(place, child(at, key)))).length;

  export async function open(what: { title: string; path: string }): Promise<void> {
    title = what.title;
    at = what.path;
    changed = false;
    asked = false;
    saved = false;
    leaving = false;
    tab = 0;
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
    <h2 id="settings-title">{title}</h2>
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
        }}><Icon of={WandSparkles} size={14} />{asked ? 'Asked the agent' : 'Ask the agent to fill in'}</button
      >
    {/if}
    <button class="x" type="button" aria-label="Close" onclick={close}><Icon of={X} size={14} /></button>
  </header>
  {#if schema && draft}
    {#if head.length}
      <div class="head">
        {#each head as key (key)}
          <SettingsField
            path={child(at, key)}
            name={label(key, !at)}
            schema={shape.properties?.[key] ?? {}}
            value={value?.[key]}
            {ctx}
            required={!!shape.required?.includes(key)}
            depth={1}
          />
        {/each}
      </div>
    {/if}
    {#if tabs.length > 1}
      <div class="tabs" role="tablist" aria-label="{title} settings">
        {#each tabs as one, index (one.name)}
          {@const wrong = wrongIn(one.keys)}
          <button
            type="button"
            role="tab"
            aria-selected={shown === one}
            class:wrong={wrong > 0}
            onclick={() => (tab = index)}
            >{one.name}{#if wrong}<span class="badge" aria-label="{wrong} to fix">{wrong}</span>{/if}</button
          >
        {/each}
      </div>
    {/if}
    <div class="body" role="tabpanel" aria-label={shown?.name}>
      {#if shown?.view === 'envs' && app && value}
        <EnvOverrides path={at} app={value} schema={shape} envs={board.envs} {ctx} />
      {:else if shown?.view === 'apps'}
        <ul class="apps">
          {#each Object.entries((value?.['apps'] ?? {}) as Record<string, { name?: string; kind?: string }>) as [id, one] (id)}
            <li>
              <KindIcon kind={one.kind ?? 'other'} label="" />
              <span class="name">{one.name ?? id}</span>
              <span class="kind"
                >{(Object.hasOwn(KINDS, one.kind ?? '') ? KINDS[one.kind ?? '']?.label : null) ?? one.kind ?? ''}</span
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
            {count} {count === 1 ? 'change' : 'changes'}, not saved yet
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
    width: min(560px, 100vw);
    max-width: none;
    height: 100vh;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--lift-high);
    font: 13px/1.45 var(--sans);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: color-mix(in oklab, var(--desk) 40%, transparent);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 14px 10px 20px;
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 17px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .x {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--muted);
    font-size: 18px;
    cursor: pointer;
  }
  .ask {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: var(--cable);
    color: var(--on-accent);
    font: 600 12px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .ask:hover:not(:disabled) {
    background: color-mix(in oklab, var(--cable) 85%, var(--ink));
  }
  .ask:focus-visible {
    outline: 2px solid var(--cable);
    outline-offset: 2px;
  }
  .ask:disabled {
    border-color: var(--line);
    background: none;
    color: var(--muted);
    cursor: default;
  }
  .head {
    display: grid;
    gap: 6px;
    padding: 0 20px 12px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    overflow-x: auto;
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
  }
  [role='tab'] {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font: 600 13px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  [role='tab']:hover {
    color: var(--ink);
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--cable);
    color: var(--ink);
  }
  [role='tab'].wrong {
    color: var(--bad);
  }
  .badge {
    min-width: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--bad);
    color: var(--on-accent);
    font-size: 11px;
    line-height: 16px;
    text-align: center;
  }
  .body {
    display: grid;
    flex: 1;
    align-content: start;
    gap: 6px;
    overflow-y: auto;
    padding: 14px 20px 20px;
  }
  .others {
    display: grid;
    gap: 6px;
    margin-top: 6px;
    color: var(--muted);
  }
  .others[open] {
    color: var(--ink);
  }
  .others summary {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
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
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .apps li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
  }
  .apps .name {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .apps .kind {
    color: var(--muted);
    font-size: 12px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  .say {
    flex: 1;
    min-width: 0;
    color: var(--muted);
  }
  .dirty .say {
    color: var(--ink);
    font-weight: 600;
  }
  footer button,
  .apps button {
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    color: var(--ink);
    font: 600 13px var(--sans);
    cursor: pointer;
  }
  .apps button {
    padding: 3px 10px;
    font-size: 12px;
  }
  footer .go {
    border-color: transparent;
    background: var(--cable);
    color: var(--on-accent);
  }
  footer .bad {
    border-color: transparent;
    background: var(--bad);
    color: var(--on-accent);
  }
  footer button:disabled,
  .apps button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
