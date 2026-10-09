import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-msg-'));
process.env.KOPPLER_TEMP = dir;
const { appendAnswer, appendMessage, clearMessages, readMessages, sanitizeMessage } = await import('../src/messages.mjs');

assert.match(sanitizeMessage(null).error, /JSON object/);
assert.match(sanitizeMessage({ summary: 'x' }).error, /needs a title/);
// Commands are kept apart from prose, so the canvas can offer each with a Copy button.
assert.deepEqual(sanitizeMessage({ title: 't', sections: [{ title: 'Run', items: ['why'], commands: ['aws sso login', '', 7] }, { commands: ['only this'] }, { items: [], commands: [] }] }).message.sections,
  [{ title: 'Run', items: ['why'], commands: ['aws sso login'] }, { title: '', items: [], commands: ['only this'] }]);
// Only known fields, bounded, as text; choices get safe ids; a message with choices is a question.
const { message } = sanitizeMessage({ title: '  Eight apps are not set up  ', summary: 'Why I stopped', run: 'muwokwvjoku9tq', apps: ['mobile-api', '../x'], evil: '<script>',
  sections: [{ title: 'What will come up', items: ['Refunds Worker cannot run locally', '', 42] }, { items: [] }],
  choices: [{ id: 'copy', label: 'Copy the four', detail: 'From the backup' }, { id: 'BAD ID', label: 'Set up all eight' }, { label: '' }] });
assert.deepEqual(message, { kind: 'question', title: 'Eight apps are not set up', summary: 'Why I stopped', run: 'muwokwvjoku9tq', apps: ['mobile-api'],
  sections: [{ title: 'What will come up', items: ['Refunds Worker cannot run locally'] }], choices: [{ id: 'copy', label: 'Copy the four', detail: 'From the backup' }, { id: '2', label: 'Set up all eight' }] });
assert.equal(sanitizeMessage({ title: 'Done', kind: 'result' }).message.kind, 'result');
assert.equal(sanitizeMessage({ title: 'x'.repeat(500) }).message.title.length, 120);

// Answers attach to their message; only the first one counts.
const m = appendMessage(message);
assert.deepEqual(readMessages().map(x => [x.id, x.answered]), [[m.id, undefined]]);
appendAnswer(m.id, { choice: 'copy' });
appendAnswer(m.id, { choice: '2' });
assert.deepEqual(readMessages()[0].answered.choice, 'copy');
fs.appendFileSync(path.join(dir, 'messages.jsonl'), 'not json\n');
assert.equal(readMessages().length, 1);
fs.rmSync(dir, { recursive: true });
// Clearing keeps only questions still waiting for an answer.
{
  const open = appendMessage({ kind: 'question', title: 'Still open?', choices: [{ id: 'a', label: 'A' }] });
  const done = appendMessage({ kind: 'question', title: 'Answered', choices: [{ id: 'a', label: 'A' }] });
  appendAnswer(done.id, { choice: 'a' });
  appendMessage({ kind: 'result', title: 'Finished' });
  assert.deepEqual(clearMessages(), { cleared: true, kept: readMessages(100).length });
  assert.deepEqual(readMessages(100).map(m => m.id), [open.id]);
}
// A question about a run a newer Send replaced is closed; one about the newest run stays open.
{
  const old = appendMessage({ kind: 'question', title: 'Old run', run: 'run000001', choices: [{ id: 'a', label: 'A' }] });
  const current = appendMessage({ kind: 'question', title: 'New run', run: 'run000002', choices: [{ id: 'a', label: 'A' }] });
  const history = [{ id: 'run000001', at: 't1' }, { id: 'run000002', at: 't2' }];
  const byId = Object.fromEntries(readMessages(100, history).map(x => [x.id, x.answered]));
  assert.deepEqual(byId[old.id], { at: 't2', via: 'replaced' });
  assert.equal(byId[current.id], undefined);
  appendAnswer(current.id, { via: 'dismissed' });
  assert.equal(readMessages(100, history).find(x => x.id === current.id).answered.via, 'dismissed');
}
console.log('messages tests ok');
