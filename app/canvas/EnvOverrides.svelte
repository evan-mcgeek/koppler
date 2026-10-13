<script lang="ts">
  // What each environment after the first uses for an app: its own value where it has one, else the first one's.
  import SettingsField from './SettingsField.svelte';
  import { child, emptyFor, ENV_FIELDS, label, summary, type Ctx, type Schema } from './settings.ts';

  const {
    path,
    app,
    schema,
    envs,
    ctx,
  }: { path: string; app: Record<string, unknown>; schema: Schema; envs: string[]; ctx: Ctx } = $props();
  const [base = 'qa', ...others] = $derived(envs);
  const overlay = (env: string) =>
    (app['envs'] as Record<string, Record<string, unknown> | undefined> | undefined)?.[env] ?? {};
  const overlaySchema = $derived(
    typeof schema.properties?.['envs']?.additionalProperties === 'object'
      ? schema.properties['envs'].additionalProperties
      : {},
  );
  const schemaFor = (key: string): Schema => overlaySchema.properties?.[key] ?? schema.properties?.[key] ?? {};
  /** The usual fields, and any other this environment already has its own value for. */
  const fieldsFor = (env: string) => [...new Set([...ENV_FIELDS, ...Object.keys(overlay(env))])];
  const NOT_PER_ENV = new Set(['name', 'kind', 'slug', 'outside', 'envs']);
  const more = (env: string) =>
    Object.keys(schema.properties ?? {}).filter(key => !NOT_PER_ENV.has(key) && !fieldsFor(env).includes(key));
  const own = (key: string) => {
    const from = app[key];
    return from === undefined ? emptyFor(schemaFor(key)) : (JSON.parse(JSON.stringify(from)) as unknown);
  };
  const at = (env: string, key: string) => child(child(child(path, 'envs'), env), key);
</script>

{#if !others.length}
  <p class="none">The stack has one environment, {base.toUpperCase()}: there is nothing to differ from.</p>
{/if}
{#each others as env (env)}
  {@const BASE = base.toUpperCase()}
  {@const ENV = env.toUpperCase()}
  <section class="env" aria-label="What {ENV} uses">
    <h3>{ENV} uses</h3>
    {#each fieldsFor(env) as key (key)}
      {#if overlay(env)[key] !== undefined}
        <SettingsField
          path={at(env, key)}
          name={label(key)}
          schema={schemaFor(key)}
          value={overlay(env)[key]}
          {ctx}
          depth={1}
          drop="Use {BASE}'s"
        />
      {:else}
        <div class="same">
          <span class="name">{label(key)}</span>
          <span class="from" title={summary(app[key])}>Same as {BASE}: {summary(app[key])}</span>
          <button type="button" onclick={() => void ctx.save(at(env, key), own(key))}>Change for {ENV}</button>
        </div>
      {/if}
    {/each}
    {#if more(env).length}
      <select
        aria-label="Give {ENV} its own value for another field"
        value=""
        onchange={ev => {
          const key = ev.currentTarget.value;
          ev.currentTarget.value = '';
          if (key) void ctx.save(at(env, key), own(key));
        }}
      >
        <option value="">Its own value for another field…</option>
        {#each more(env) as key (key)}<option value={key}>{label(key)}</option>{/each}
      </select>
    {/if}
  </section>
{/each}

<style>
  .none {
    margin: 0;
    color: var(--muted);
  }
  .env {
    display: grid;
    gap: 6px;
  }
  .env + .env {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  h3 {
    margin: 0 0 2px;
    font-size: 13px;
  }
  .same {
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 10px;
    min-height: 28px;
  }
  .name {
    font-weight: 500;
  }
  .from {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .same button {
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 12px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  select {
    justify-self: start;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink);
    font: 13px var(--sans);
  }
</style>
