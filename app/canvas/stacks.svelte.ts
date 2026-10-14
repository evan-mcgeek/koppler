// The stacks this page can switch to, and the shared stack a linked one comes from: switching, updating, and sharing
// or dropping what this copy learned. Leaving a stack while something runs goes through a Stop and revert first.
import { board } from './board.svelte.ts';
import { post } from './data.ts';
import { live } from './live.svelte.ts';
import { runs } from './run.svelte.ts';
import { toasts } from './toast.svelte.ts';

class Stacks {
  /** The stack being switched to from this page, until the page reloads with it. */
  switching = $state<string | null>(null);

  /** Another stack: at once when nothing runs here, else after the Stop and revert its review shows. */
  useStack(to: { dir: string; name: string }): void {
    if (runs.idle) {
      void this.#switch(to.dir);
      return;
    }
    runs.stopReview({
      title: `Switch to ${to.name}`,
      sub: `${board.stack} still has something running. It is stopped and reverted first, then Koppler switches.`,
      notices: [{ text: `Your boards and history for ${board.stack} are kept and come back when you switch back.` }],
      ok: 'Stop, revert and switch',
      text: `Stop and revert this stack using the koppler-run skill (stop every process the agent started, revert every temporary code change), then switch Koppler to the stack "${to.name}": koppler history done <this run's id>, then koppler use "${to.dir}". Report what was stopped and reverted.`,
      sent: 'Sent. Koppler switches once everything is stopped',
      data: { switchTo: to.dir },
    });
  }
  /** Calls a stack action on the server that answers with a result or an error. */
  async #stack<T extends object>(action: string): Promise<T | null> {
    const said = await post<T>(action);
    if (!('error' in said)) return said;
    toasts.show(said.error, 'warning');
    return null;
  }
  /** Brings in what changed in the shared stack on GitHub. */
  async updateStack(): Promise<void> {
    const said = await this.#stack<{ updated?: boolean; message?: string }>('stack-update');
    if (said?.updated) location.reload();
    else if (said) toasts.show(said.message ?? 'Already up to date.');
  }
  /** What this copy of a linked stack has that the shared one does not: shared as a pull request, or dropped. */
  shareChanges(): void {
    const linked = live.status?.linked;
    if (!linked) return;
    const items = linked.changes.map(change => ({
      name: change.replace(/^./, first => first.toUpperCase()),
      notes: [],
    }));
    const groups = [{ verb: 'keeps', label: 'Changes', items }];
    runs.review = {
      title: 'Changes not in the shared stack yet',
      sub: `What Koppler learned here, kept in your copy of ${board.stack}. The shared stack on GitHub stays as it is until a pull request is merged.`,
      notices: [
        ...(linked.pr
          ? [
              {
                text: `A pull request is already open: ${linked.pr}. Opening another replaces nothing; close the old one if you open a new one.`,
              },
            ]
          : []),
        {
          text: 'Opening a pull request pushes a new branch to the shared repo with your GitHub account, for your team to review. No secret values are in it.',
        },
      ],
      groups,
      ok: 'Open pull request',
      prod: false,
      blocked: false,
      confirm: () => {
        toasts.show('Opening the pull request…');
        void this.#stack<{ url?: string }>('stack-pr').then(said => {
          if (said)
            toasts.show('Pull request opened', 'message', {
              label: 'View',
              run: () => window.open(said.url, '_blank', 'noopener'),
            });
        });
      },
      back: {
        label: 'Discard my changes instead',
        run: () => {
          runs.review = {
            title: 'Discard your changes',
            sub: `Your copy of ${board.stack} goes back to the shared stack as last fetched. What Koppler learned here is lost.`,
            notices: [],
            groups,
            ok: 'Discard',
            prod: true,
            blocked: false,
            confirm: () => {
              void this.#stack('stack-discard').then(said => {
                if (said) location.reload();
              });
            },
          };
        },
      },
    };
  }
  /** A new stack, or one from GitHub: asked for at once when nothing runs, else after a Stop and revert. */
  addStack(ask: () => void): void {
    if (runs.idle) {
      ask();
      return;
    }
    runs.stopReview({
      title: 'Start a new stack',
      sub: `${board.stack} still has something running. It is stopped and reverted first; then choose Add a stack again.`,
      notices: [{ text: `Your boards and history for ${board.stack} are kept and come back when you switch back.` }],
      ok: 'Stop and revert',
      text: 'Stop and revert this stack using the koppler-run skill (stop every process the agent started, revert every temporary code change), so the user can start a new stack. Report what was stopped and reverted.',
      sent: 'Stopping and reverting',
    });
  }
  async #switch(dir: string): Promise<void> {
    this.switching = dir;
    const said = await post<{ error?: string }>('stack', { use: dir });
    if (!said.error) {
      location.reload();
      return;
    }
    this.switching = null;
    toasts.show(said.error, 'warning');
  }
}
export const stacks = new Stacks();
