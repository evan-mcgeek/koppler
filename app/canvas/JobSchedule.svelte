<script lang="ts">
  // A scheduled job's schedule, one row per environment of the stack, each read back in words or said to be wrong.
  import { readSchedule } from '../src/core/schedule.ts';
  import type { Ctx } from './settings.ts';

  const { path, schedule, envs, ctx }: { path: string; schedule: Record<string, string>; envs: string[]; ctx: Ctx } =
    $props();
</script>

<div class="schedule">
  <div class="rows">
    {#each envs as env (env)}
      {@const text = schedule[env] ?? ''}
      {@const read = text.trim() ? readSchedule(text) : null}
      <label class="row">
        <span class="env">{env.toUpperCase()}</span>
        <input
          class="expression"
          type="text"
          value={text}
          placeholder="rate(1 hour) or cron(0 0 * * ? *)"
          aria-label="Schedule on {env.toUpperCase()}"
          aria-invalid={!!read && 'error' in read}
          spellcheck="false"
          autocomplete="off"
          onchange={ev => void ctx.save(`${path}.${env}`, ev.currentTarget.value.trim())}
        />
        <span class="read" class:bad={!!read && 'error' in read} aria-live="polite"
          >{read ? ('error' in read ? read.error : read.words) : ''}</span
        >
      </label>
    {/each}
  </div>
  <p class="about">
    Per environment. EventBridge cron or rate expressions; the words are read back so you can check them.
  </p>
  <p class="not">
    <b>Not for a job</b>: URL, Health check, Start command, Port, Branch to run. They come back if Runs as is set to A
    service.
  </p>
</div>

<style>
  .schedule {
    padding: 14px 20px;
  }
  .rows {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: 10px;
  }
  .env {
    color: var(--ink-muted);
    font: 11px var(--mono);
  }
  .expression {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line);
    background: var(--desk);
    color: var(--ink);
    font: 12px var(--mono);
  }
  .expression[aria-invalid='true'] {
    border-color: var(--warn);
  }
  .read {
    color: var(--ink-muted);
    font: 12px var(--mono);
  }
  .read.bad {
    color: var(--warn);
    font-family: var(--sans);
  }
  .about,
  .not {
    margin: 10px 0 0;
    color: var(--ink-muted);
    font: 12px var(--sans);
  }
  .not b {
    color: var(--ink);
    font-weight: 600;
  }
</style>
