// 0.5.2: an app that is a GitHub Actions workflow, written as kind other, becomes kind workflow, so Discover counts it as
// a job. Only when its deployed address is the workflow's page on GitHub; any other is left as it was.
import type { Migration, Raw } from '../run.ts';

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const WORKFLOW_PAGE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/workflows\/[^/]+\.ya?ml$/i;

export const workflowKind: Migration = {
  version: '0.5.2',
  about: 'An app of kind other whose deployed address is a GitHub Actions workflow becomes kind workflow',
  up: (raw, say) => {
    const next = structuredClone(raw);
    for (const [id, app] of Object.entries(isObject(next['apps']) ? next['apps'] : {}))
      if (
        isObject(app) &&
        app['kind'] === 'other' &&
        !app['outside'] &&
        typeof app['deployedUrl'] === 'string' &&
        WORKFLOW_PAGE.test(app['deployedUrl'].trim())
      ) {
        app['kind'] = 'workflow';
        say(`${id}: kind other became workflow`);
      }
    return next;
  },
};
