// The debug log: when on, every click, choice, shortcut, message and page error is kept with a short summary of the
// board, sent to the canvas server in small batches, for tracing a problem later. Typed text is never kept.
import { board } from './board.svelte.ts';
import { live } from './live.svelte.ts';

interface Entry {
  at: string;
  kind: string;
  what: string;
  detail?: string;
  board: object;
}
const token = () => encodeURIComponent(location.pathname.split('/')[2] ?? '');
const post = (route: string, body: object) =>
  fetch(`/${route}?token=${token()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
/** An element as it reads on screen: what it is, its label, and the card it is on. */
const describe = (el: Element): string => {
  const named =
    (el.matches('input[type="radio"], input[type="checkbox"]') && el.closest('label')) ||
    el.closest(
      'button, a, [role="button"], [role="option"], [role="radio"], [role="menuitem"], label, input, select, summary, .svelte-flow__node, .svelte-flow__edge',
    ) ||
    el;
  // A field is named by its label, the way it reads on screen.
  const labelled = named instanceof HTMLInputElement || named instanceof HTMLSelectElement ? named.labels?.[0] : null;
  const text = (named.getAttribute('aria-label') ?? named.getAttribute('title') ?? (labelled ?? named).textContent)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const where = named.closest('.svelte-flow__node, .svelte-flow__edge')?.getAttribute('data-id') ?? '';
  return `${named.tagName.toLowerCase()}${text ? ` "${text}"` : ''}${where ? ` in ${where}` : ''}`;
};
/** Typed text is never kept: from fields only their name, and from a credential form nothing at all. */
const secret = (el: Element) => !!el.closest('[type="password"], [data-secret]');

class Debug {
  #chosen = $state(false);
  #queue: Entry[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** While Koppler runs from its source folder the log is always on; the user's own choice is kept for later. */
  get forced(): boolean {
    return !!live.status?.dev;
  }
  get on(): boolean {
    return this.#chosen || this.forced;
  }
  set on(value: boolean) {
    this.#chosen = value;
    try {
      localStorage.setItem('koppler-debug', value ? 'on' : 'off');
    } catch {
      // Storage is off: the choice lasts as long as the page.
    }
    if (value) this.note('debug', 'Debug log on');
  }

  note(kind: string, what: string, detail?: string): void {
    if (!this.on) return;
    const now = {
      apps: board.nodes.length,
      cables: board.edges.length,
      view: board.live ? 'live' : 'edit',
      env: board.env,
      zoom: Math.round((board.view?.zoom ?? 1) * 100) / 100,
    };
    this.#queue.push({
      at: new Date().toISOString(),
      kind,
      what,
      ...(detail && { detail: detail.slice(0, 300) }),
      board: now,
    });
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.flush();
    }, 1500);
  }
  flush(): void {
    const entries = this.#queue.splice(0);
    if (entries.length) void post('debug-log', { entries });
  }
  /** The last 300 entries, as text; empty when there are none. */
  async read(): Promise<string> {
    this.flush();
    await new Promise(done => setTimeout(done, 300));
    const text = await fetch(`temp/debug.jsonl?${String(Date.now())}`)
      .then(answer => (answer.ok ? answer.text() : ''))
      .catch(() => '');
    return text.trim().split('\n').slice(-300).join('\n');
  }
  clear(): void {
    this.#queue = [];
    void post('debug-clear', {});
  }

  /** Starts keeping what happens on the page. Called once. */
  watch(): void {
    try {
      this.#chosen = localStorage.getItem('koppler-debug') === 'on';
    } catch {
      // Storage is off: the log starts off.
    }
    const on = { capture: true };
    addEventListener(
      'click',
      ev => {
        if (ev.target instanceof Element && !secret(ev.target)) this.note('click', describe(ev.target));
      },
      on,
    );
    addEventListener(
      'change',
      ev => {
        const el = ev.target;
        if (!(el instanceof Element) || secret(el)) return;
        const choice =
          el instanceof HTMLInputElement && el.type === 'checkbox'
            ? String(el.checked)
            : el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'radio')
              ? el.value
              : '(typed)';
        this.note('change', describe(el), choice);
      },
      on,
    );
    addEventListener(
      'keydown',
      ev => {
        const typing =
          ev.target instanceof Element &&
          !!ev.target.closest('input:not([type="radio"]):not([type="checkbox"]), textarea, select, [contenteditable]');
        if ((!ev.metaKey && !ev.ctrlKey && typing) || ev.key.length > 12) return;
        const keys = [ev.metaKey && 'Cmd', ev.ctrlKey && 'Ctrl', ev.shiftKey && 'Shift', ev.altKey && 'Alt', ev.key];
        this.note('key', keys.filter(Boolean).join('+'));
      },
      on,
    );
    addEventListener('error', ev => {
      this.note(
        'error',
        ev.message || 'page error',
        ev.filename ? `${ev.filename.split('/').pop() ?? ''}:${String(ev.lineno)}` : '',
      );
    });
    addEventListener('unhandledrejection', ev => {
      const reason: unknown = ev.reason;
      const said = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
      this.note('error', said || 'unhandled rejection');
    });
    addEventListener('pagehide', () => {
      this.flush();
    });
  }
}
export const debug = new Debug();
