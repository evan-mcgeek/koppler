// Messages from the agent: questions with choices, results and failures. Answers go back to the agent.
import { live, type Answered, type Message } from './live.svelte.ts';
import { toasts } from './toast.svelte.ts';

export type { Message };
const send = (route: string, body: object) =>
  fetch(`/${route}?token=${encodeURIComponent(location.pathname.split('/')[2] ?? '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);

class Inbox {
  open = $state(false);
  /** What was answered or cleared here, ahead of the next status. */
  #answered = $state<Record<string, Answered>>({});
  #cleared = $state(false);
  #seen = new Set<string>();
  #ready = false;
  /** The message from Koppler that opened the panel by itself. */
  #refused = '';

  /** Newest first. */
  get messages(): Message[] {
    const all = [...(live.status?.messages ?? [])].reverse();
    return all
      .map((one): Message => ({ ...one, answered: this.#answered[one.id] ?? one.answered ?? null }))
      .filter(one => !this.#cleared || (one.kind === 'question' && !one.answered));
  }
  /** The question still waiting for an answer, if any. */
  get question(): Message | undefined {
    return this.messages.find(one => one.kind === 'question' && one.choices?.length && !one.answered);
  }

  /** A new question opens the panel by itself; anything else new is announced. Called on each status. */
  follow(): void {
    if (!live.status) return;
    for (const one of this.messages) {
      if (this.#seen.has(one.id)) continue;
      this.#seen.add(one.id);
      if (!this.#ready) continue;
      // What Koppler could not do itself needs the user, like a question: the panel opens on it.
      if (one.kind === 'question' && !one.answered) this.open = true;
      else if (one.from === 'koppler' && !one.answered) {
        this.open = true;
        this.#refused = one.id;
      } else
        toasts.show(`Agent: ${one.title}`, one.kind === 'failure' ? 'warning' : 'message', {
          label: 'Open',
          run: () => (this.open = true),
        });
    }
    this.#ready = true;
    // The panel opened on what Koppler could not start: another run was sent, so it closes again.
    if (this.#refused && this.messages.find(one => one.id === this.#refused)?.answered) {
      this.#refused = '';
      if (!this.question) this.open = false;
    }
    // The server's list no longer has what was cleared here.
    if (this.#cleared && !(live.status.messages ?? []).some(one => !(one.kind === 'question' && !one.answered)))
      this.#cleared = false;
  }

  async answer(message: Message, given: { choice?: string; text?: string }): Promise<void> {
    const choice = message.choices?.find(one => one.id === given.choice);
    const said = choice ? `${choice.label}${given.text ? `. ${given.text}` : ''}` : (given.text ?? '');
    const text = `Answer to your question "${message.title}"${message.run ? ` (run ${message.run})` : ''}: ${said}`;
    const answer = await send('prompt', { tag: 'koppler-reply', text, data: { message: message.id, ...given } });
    if (!answer?.ok) {
      toasts.show(
        answer?.status === 409 ? 'That question was already answered.' : 'Could not send the answer.',
        'warning',
      );
      return;
    }
    this.#answered[message.id] = { at: new Date().toISOString(), ...given, via: 'canvas' };
    if ((live.status?.agent?.state ?? 'none') === 'none')
      toasts.show('Answer saved. The agent gets it when one connects.');
  }
  /** Closes a question without answering; the agent is not told. */
  async dismiss(message: Message): Promise<void> {
    const answer = await send('message-dismiss', { id: message.id });
    if (!answer?.ok && answer?.status !== 409) {
      toasts.show('Could not dismiss it.', 'warning');
      return;
    }
    this.#answered[message.id] = { at: new Date().toISOString(), via: 'dismissed' };
  }
  /** What was sent for an agent and not taken yet, newest first. */
  get waiting() {
    return [...(live.status?.waiting ?? [])].reverse().filter(one => !this.#dropped.includes(one.key));
  }
  #dropped = $state<string[]>([]);
  /** Takes a waiting request out of the queue, so no agent gets it. */
  async drop(key: string): Promise<void> {
    const answer = await send('prompt-drop', { key });
    if (answer?.ok || answer?.status === 409) this.#dropped = [...this.#dropped, key];
    else toasts.show('Could not drop it.', 'warning');
  }
  /** Empties the history; a question still waiting for an answer stays. */
  async clear(): Promise<void> {
    const answer = await send('messages-clear', {});
    if (!answer?.ok) {
      toasts.show('Could not clear the messages.', 'warning');
      return;
    }
    this.#cleared = true;
    if (this.question) toasts.show('Cleared. The open question stays.');
  }
}
export const inbox = new Inbox();
