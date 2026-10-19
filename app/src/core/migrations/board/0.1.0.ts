// 0.1.0: every app on a board says how it runs; a board from before left it out for the ones Koppler starts.
import type { Migration, Raw } from '../run.ts';

export const everyAppSaysHowItRuns: Migration = {
  version: '0.1.0',
  about: 'Every app on a board says how it runs',
  up: (raw, say) => {
    const nodes = (raw['nodes'] ?? {}) as Record<string, Raw>;
    for (const [id, node] of Object.entries(nodes))
      if (node['run'] === undefined) {
        node['run'] = 'cli';
        say(`${id} runs by Koppler, as it did`);
      }
    return { ...raw, nodes };
  },
};
