// A page for someone new to a stack: its apps, which call which, its features, and what this Mac needs for each.
// Read from the stack alone, so it is written without clones.
import { linksOf, type Card, type Facts } from './discover.ts';
import { featureOf, numbered } from './feature.ts';
import { of as kindOf } from './kinds.ts';
import { appOn, type Prereq, type Secret, type Stack } from './stack.ts';

const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${String(names.at(-1))}` : (names[0] ?? '');

/** One need, in words. */
export function needText(need: Prereq): string {
  const said =
    (need.tunnel &&
      `A tunnel to ${need.what ?? need.tunnel}${need.port ? ` on port ${String(need.port)}` : ''}${need.cmd ? `: \`${need.cmd}\`` : ''}`) ||
    (need.sso &&
      `Signed in to AWS with the profile \`${need.sso}\`${need.account ? ` (account ${need.account})` : ''}`) ||
    (need.signIn && `Signed in to ${need.signIn}`) ||
    (need.hosts && `\`${need.hosts}\` pointing at this Mac in /etc/hosts`) ||
    (need.devCerts && 'The local HTTPS certificate trusted') ||
    (need.nuget && 'Access to the private package feed') ||
    (need.cmd && `\`${need.cmd}\``) ||
    '';
  return [said, need.note].filter(Boolean).join('. ');
}

const secretText = (secret: Secret) => {
  const name = secret.env ? `\`${secret.env}\`` : secret.file ? `the file \`${secret.file}\`` : 'a secret';
  const where = secret.fetch?.ui ?? (secret.fetch?.cli && `\`${secret.fetch.cli}\``);
  const got = [`The secret ${name}${secret.when ? `, ${secret.when}` : ''}`, where && `from ${where}`];
  return [got.filter(Boolean).join(', '), secret.note].filter(Boolean).join('. ');
};

export function guide(stack: Stack): string {
  const facts = stack as unknown as Facts;
  const links = linksOf(facts);
  const name = (card: Card) => {
    const [kind, id = ''] = card.includes(':') ? card.split(/:(.*)/s) : ['app', card];
    if (kind === 'queue') return stack.queues?.[id]?.name ?? id;
    if (kind === 'database') return stack.databases?.[id]?.name ?? id;
    if (kind === 'resource') return stack.resources?.[id]?.name ?? id;
    return stack.apps[card]?.name ?? card;
  };
  const by = (a: string, b: string) => name(a).localeCompare(name(b));
  const ids = Object.keys(stack.apps).sort(by);
  const out: string[] = [`# ${stack.name ?? 'The stack'}`, ''];
  const notes = typeof stack.notes === 'string' ? [stack.notes] : (stack.notes ?? []);
  if (notes.length) out.push(...notes.map(note => `- ${note}`), '');
  out.push(`Environments: ${stack.envs.join(', ')}.`, '', '## Apps', '');
  for (const id of ids.filter(one => !stack.apps[one]?.outside)) {
    const app = stack.apps[id];
    if (!app) continue;
    out.push(`### ${app.name}`, '', `${kindOf(app, stack).label}${app.slug ? `, in \`${app.slug}\`` : ''}.`);
    const rows: [string, Card[]][] = [
      ['Calls', links.filter(l => l.kind === 'call' && l.from === id && l.sure === 'confirmed').map(l => l.to)],
      ['Called by', links.filter(l => l.kind === 'call' && l.to === id && l.sure === 'confirmed').map(l => l.from)],
      ['Sends to', links.filter(l => l.kind === 'publish' && l.from === id).map(l => l.to)],
      ['Reads', links.filter(l => l.kind === 'read' && l.to === id).map(l => l.from)],
      ['Uses', links.filter(l => l.kind === 'uses' && l.from === id).map(l => l.to)],
    ];
    const said = rows.filter(([, cards]) => cards.length);
    if (said.length) out.push('', ...said.map(([what, cards]) => `- ${what} ${list([...new Set(cards)].map(name))}.`));
    // An environment's list replaces the first one's whole, so each is said once, or once for all when they agree.
    const needs = stack.envs.map(env => {
      const on = appOn(stack, id, env);
      return [...(on?.prereqs ?? []).map(needText), ...(on?.secrets ?? []).map(secretText)].filter(Boolean);
    });
    const same = needs.every(one => JSON.stringify(one) === JSON.stringify(needs[0]));
    for (const [at, env] of stack.envs.entries()) {
      const these = needs[at] ?? [];
      if (!these.length || (same && at > 0)) continue;
      out.push('', same ? 'To run it here:' : `To run it here on ${env}:`, '', ...these.map(one => `- ${one}`));
    }
    out.push('');
  }
  const outside = ids.filter(one => stack.apps[one]?.outside);
  if (outside.length) {
    out.push('## Outside systems', '');
    for (const id of outside) {
      const app = stack.apps[id];
      const what = typeof app?.outside === 'string' ? `: ${app.outside}` : '';
      out.push(`- ${name(id)}${what}`);
    }
    out.push('');
  }
  const features = (stack.presets ?? []).flatMap(preset => {
    const feature = featureOf((preset as { feature?: unknown }).feature);
    return feature ? [{ name: preset.name, feature }] : [];
  });
  if (features.length) {
    out.push('## Features', '');
    for (const { name: title, feature } of features) {
      out.push(`### ${title}`, '');
      if (feature.request) out.push(`> ${feature.request}`, '');
      for (const [at, phase] of feature.phases.entries()) {
        out.push(`${String(at + 1)}. ${phase.name}`);
        for (const { step, number } of numbered(feature).filter(one => one.phase === at))
          out.push(`   - ${number} ${name(step.from)} → ${name(step.to)}${step.note ? `: ${step.note}` : ''}`);
      }
      out.push('');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}
