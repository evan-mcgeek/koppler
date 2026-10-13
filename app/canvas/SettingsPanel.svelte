<script lang="ts">
  // Settings for one part of the stack (an app, a queue, the whole stack), opened from the gear next to it. Every field
  // its schema has is shown, filled in; each change is checked and kept as it is made, and a lock keeps a field as it is.
  import { getAt, parsePath, setAt } from '../src/core/stack-path.ts';
  import SettingsField from './SettingsField.svelte';
  import { board } from './board.svelte.ts';
  import { post } from './data.ts';
  import { live } from './live.svelte.ts';
  import { runs } from './run.svelte.ts';
  import { lockedBy, type Ctx, type Schema } from './settings.ts';

  let dialog = $state<HTMLDialogElement>();
  let title = $state('');
  let at = $state('');
  let stack = $state<unknown>(null);
  let schema = $state<Schema | null>(null);
  let locks = $state<string[]>([]);
  let changed = false;
  let asked = $state(false);
  // An app's panel: the agent can fill it in from the repo.
  const app = $derived(/^apps\.[a-z0-9-]+$/.test(at) ? at.slice(5) : null);
  /** The app's fields its schema has that hold nothing yet. */
  const empties = () => {
    const own = getAt(stack, ['apps', app ?? '']) as Record<string, unknown> | undefined;
    const shape = schema ? schemaAt(schema, at) : {};
    return Object.keys(shape.properties ?? {}).filter(key => own?.[key] === undefined && key !== 'outside');
  };

  /** The schema of the field at a path, walked down from the stack's. */
  const schemaAt = (root: Schema, path: string): Schema => {
    if (!path) return root;
    const parts = parsePath(path);
    if ('error' in parts) return {};
    let here: Schema = root;
    for (const part of parts) {
      if (typeof part === 'number') here = here.items ?? {};
      else
        here =
          here.properties?.[part] ?? (typeof here.additionalProperties === 'object' ? here.additionalProperties : {});
    }
    return here;
  };

  export async function open(what: { title: string; path: string }): Promise<void> {
    title = what.title;
    at = what.path;
    changed = false;
    asked = false;
    locks = live.status?.locks ?? [];
    const [shape, registry] = await Promise.all([
      schema
        ? Promise.resolve(schema)
        : fetch('data/stack-schema.json').then(answer => answer.json() as Promise<Schema>),
      fetch('data/registry.json').then(answer => answer.json() as Promise<Record<string, unknown>>),
    ]);
    schema = shape;
    const { source: _source, found: _found, ...own } = registry;
    stack = own;
    dialog?.showModal();
  }

  const ctx: Ctx = {
    save: async (path, value) => {
      const said = await post<{ value?: unknown }>(
        'stack-edit',
        value === undefined ? { path, unset: true } : { path, value },
      );
      if ('error' in said) return said.error;
      const parts = parsePath(path);
      if (!('error' in parts)) stack = setAt(stack, parts, value);
      changed = true;
      return null;
    },
    locked: path => lockedBy(locks, path),
    lock: (path, on) => {
      void post('stack-lock', { path, on }).then(said => {
        if (!('error' in said)) locks = on ? [...locks, path] : locks.filter(one => one !== path);
      });
    },
    keys: path => {
      if (/(^|\.)consumes$/.test(path))
        return board.apps.map(app => app.id).filter(id => !path.startsWith(`apps.${id}.`));
      if (/(^|\.)(envs|sam\.envs)$/.test(path)) return board.envs;
      if (/(^|\.)(publishes|reads)$/.test(path))
        return Object.keys((getAt(stack, ['queues']) as Record<string, unknown> | undefined) ?? {});
      return null;
    },
  };
  const close = () => {
    dialog?.close();
    // What the board shows comes from the stack: it opens again with the change.
    if (changed) location.reload();
  };
</script>

<dialog bind:this={dialog} aria-labelledby="settings-title" oncancel={close}>
  <header>
    <h2 id="settings-title">{title}</h2>
    <button class="x" type="button" aria-label="Close" onclick={close}>×</button>
  </header>
  <p class="sub">
    Every change is checked and kept as you make it. A lock keeps a field as it is, for you and the agent.
  </p>
  {#if app}
    <p class="ask">
      <button
        type="button"
        class="go"
        disabled={asked}
        onclick={async () => {
          asked = await runs.askFill(
            app,
            empties(),
            locks.filter(one => one.startsWith(`apps.${app}.`)),
          );
        }}>{asked ? 'Asked the agent' : 'Ask the agent to fill in'}</button
      >
      <span>It reads the repo, says what it would set, and asks you first. Locked fields stay as they are.</span>
    </p>
  {/if}
  {#if schema && stack}
    <div class="body">
      <SettingsField
        path={at}
        name={title}
        schema={schemaAt(schema, at)}
        value={getAt(stack, ('error' in parsePath(at) ? [] : parsePath(at)) as (string | number)[])}
        {ctx}
        required
      />
    </div>
  {/if}
</dialog>

<style>
  dialog {
    position: fixed;
    inset: 0 0 0 auto;
    width: min(520px, 100vw);
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
    gap: 8px;
    padding: 16px 16px 0 20px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
  }
  .sub {
    margin: 4px 20px 12px;
    color: var(--muted);
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
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 20px 12px;
    color: var(--muted);
    font-size: 12px;
  }
  .go {
    flex: none;
    padding: 5px 12px;
    border: 0;
    border-radius: 7px;
    background: var(--cable);
    color: var(--on-accent);
    font: 600 12px var(--sans);
    cursor: pointer;
  }
  .go:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 20px 24px;
  }
</style>
