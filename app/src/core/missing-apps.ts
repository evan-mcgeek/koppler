// Kept free of Node's modules: the canvas reads stacks through the migrations that use it.
type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const entries = (table: unknown): [string, unknown][] => (isObject(table) ? Object.entries(table) : []);

/**
 * The stack with every mention of an app it does not have taken out: other apps' calls to it and order after it, and
 * its cards on the team boards with the cables that touch them. What names an app it has is left as it is.
 */
export function withoutMissingApps<S extends Loose>(stack: S): S {
  const apps = stack['apps'];
  if (!isObject(apps)) return stack;
  const missing = (id: unknown) => typeof id === 'string' && !Object.hasOwn(apps, id);
  const own = (app: unknown): unknown => {
    if (!isObject(app)) return app;
    const next: Loose = { ...app };
    if (isObject(app['consumes']))
      next['consumes'] = Object.fromEntries(entries(app['consumes']).filter(([to]) => !missing(to)));
    if (Array.isArray(app['after'])) {
      const after = app['after'].filter(dep => !missing(dep));
      if (after.length) next['after'] = after;
      else delete next['after'];
    }
    return next;
  };
  const board = (preset: unknown): unknown => {
    if (!isObject(preset)) return preset;
    const gone = new Set(
      entries(preset['nodes'])
        .map(([id]) => id)
        .filter(missing),
    );
    if (!gone.size) return preset;
    const touches = (edge: unknown) =>
      isObject(edge) && (gone.has(String(edge['from'])) || gone.has(String(edge['to'])));
    return {
      ...preset,
      nodes: Object.fromEntries(entries(preset['nodes']).filter(([id]) => !gone.has(id))),
      ...(Array.isArray(preset['edges']) && { edges: preset['edges'].filter(edge => !touches(edge)) }),
    };
  };
  return {
    ...stack,
    apps: Object.fromEntries(entries(apps).map(([id, app]) => [id, own(app)])),
    ...(Array.isArray(stack['presets']) && { presets: stack['presets'].map(board) }),
  };
}
