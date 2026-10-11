// What the page sends is never taken as it comes: a board, a layout or a prompt keeps only its known fields, each cut
// to size, so no endpoint can be used to write anything else.
import { githubFile, readFile } from '../github.ts';

type Loose = Record<string, unknown>;
interface Point {
  x: number;
  y: number;
}
/** Where a board's cards and tunnels sit, and which sides its cables use. */
export interface BoardLayout {
  nodes: Record<string, Point>;
  infra?: Record<string, Point>;
  sides?: Record<string, unknown>;
  tidy?: string;
}
interface PresetNode {
  run: string;
  platform?: string;
  branch?: string;
  note?: string;
  tunnels?: false;
}
/** A board: a name, apps with how they run, cables between them, and where an opened one came from. */
export interface Preset {
  name: string;
  version?: number;
  nodes: Record<string, PresetNode>;
  edges: { from: string; to: string }[];
  source?: string;
  layout?: BoardLayout;
}
/** A prompt from the page, on its way to Koppler or the agent. */
export interface Prompt {
  tag: string;
  text: string;
  data: Loose;
  at: string;
}

export const MAX_NOTE = 4000;
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
const isObject = (value: unknown): value is Loose => !!value && typeof value === 'object';
const isMap = (value: unknown): value is Loose => isObject(value) && !Array.isArray(value);
const listOf = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
/** A value read as an object: anything else has none of the fields asked for. */
const fieldsOf = (value: unknown) => (isObject(value) ? value : {});
const xy = (value: unknown): Point => ({ x: num(fieldsOf(value)['x']), y: num(fieldsOf(value)['y']) });
const note = (value: unknown) => (typeof value === 'string' && value ? { note: text(value, MAX_NOTE) } : {});
/** A card that is not an app: a tunnel, a queue or an outside system. */
const CARD = /^(tunnel:[\w.-]{1,253}:\d{1,5}|(queue|outside):[a-z0-9-]{1,64})$/;
const WHEN = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;
const TIDY = ['down', 'right'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const slot = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < 1000 ? value : null;
const shift = (value: unknown) => (typeof value === 'number' && Math.abs(value) <= 10000 ? value : null);
/** The waypoints a cable runs through. */
const waypoints = (value: unknown): Point[] | null => {
  const points = listOf(value)
    .filter(point => isObject(point) && Number.isFinite(point['x']) && Number.isFinite(point['y']))
    .slice(0, 20)
    .map(xy);
  return points.length ? points : null;
};
const cables = (value: unknown) =>
  listOf(value)
    .map(fieldsOf)
    .filter(edge => isId(edge['from']) && isId(edge['to']));

/** Where a board's cards and tunnels sit, and which sides its cables use: kept with the board so it reopens as it was left. */
function boardLayout(given: unknown): BoardLayout | null {
  if (!isMap(given) || !isObject(given['nodes'])) return null;
  const nodes = Object.fromEntries(
    Object.entries(given['nodes'])
      .filter(([key]) => isId(key))
      .slice(0, 200)
      .map(([key, at]) => [key, xy(at)]),
  );
  if (!Object.keys(nodes).length) return null;
  const infra = Object.fromEntries(
    Object.entries(fieldsOf(given['infra']))
      .filter(([key]) => CARD.test(key))
      .slice(0, 100)
      .map(([key, at]) => [key, xy(at)]),
  );
  // Per cable: its two sides, two unused places, its slot on each side, its waypoints, and where Arrange centred
  // each end. Older boards hold only the sides.
  const sides = Object.fromEntries(
    Object.entries(fieldsOf(given['sides']))
      .filter(([key]) => key.split('>').length === 2 && key.split('>').every(isId))
      .flatMap(([key, value]): [string, unknown[]][] => {
        const [fromSide, toSide, , , fromSlot, toSlot, points, fromShift, toShift] = listOf(value);
        if (!SIDES.includes(fromSide as string) || !SIDES.includes(toSide as string)) return [];
        const more = [null, null, slot(fromSlot), slot(toSlot), waypoints(points), shift(fromShift), shift(toShift)];
        return [[key, [fromSide, toSide, ...(more.some(one => one !== null) ? more : [])]]];
      })
      .slice(0, 500),
  );
  const tidy = given['tidy'];
  return {
    nodes,
    ...(Object.keys(infra).length && { infra }),
    ...(Object.keys(sides).length && { sides }),
    ...(TIDY.includes(tidy as string) && { tidy: tidy as string }),
  };
}

export function sanitizePresets(list: unknown): Preset[] {
  return listOf(list)
    .slice(0, 50)
    .map(fieldsOf)
    .filter(preset => typeof preset['name'] === 'string' && preset['name'] && isMap(preset['nodes']))
    .map(preset => {
      const { version, source } = preset;
      const layout = boardLayout(preset['layout']);
      const nodes = Object.entries(preset['nodes'] as Loose).filter(([key]) => isId(key));
      return {
        name: text(preset['name'], 80),
        ...(typeof version === 'number' && Number.isInteger(version) && version >= 0 && version < 1000 && { version }),
        nodes: Object.fromEntries(
          nodes.map(([key, given]): [string, PresetNode] => {
            const node = fieldsOf(given);
            return [
              key,
              {
                run: text(node['run'], 16),
                ...(!!node['platform'] && { platform: text(node['platform'], 16) }),
                ...(!!node['branch'] && { branch: text(node['branch']) }),
                ...note(node['note']),
                ...(node['tunnels'] === false && { tunnels: false as const }),
              },
            ];
          }),
        ),
        edges: cables(preset['edges']).map(edge => ({ from: edge['from'] as string, to: edge['to'] as string })),
        ...(typeof source === 'string' && source && { source: text(source, 300) }),
        ...(layout && { layout }),
      };
    });
}
/** The presets in a file: one preset, a list of them, or a stack.json with "presets". */
export const presetsIn = (data: unknown): Preset[] => {
  const inside = fieldsOf(data)['presets'];
  return sanitizePresets(Array.isArray(data) ? data : Array.isArray(inside) ? inside : [data]);
};

const MAX_PRESET_BYTES = 300 * 1024;
/** The boards in a file on GitHub, read through the user's own gh login (private repos), else as a public file. */
export async function fetchPresets(
  link: string,
): Promise<{ presets: Preset[]; error?: undefined } | { error: string }> {
  const file = githubFile(link);
  if (!file) return { error: 'Only https links to a file on GitHub can be opened.' };
  const body = await readFile(file);
  if (body === null || body.length > MAX_PRESET_BYTES)
    return { error: 'Could not read that file. Check the link, and that gh is signed in for a private repo.' };
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { error: 'That file is not JSON.' };
  }
  const presets = presetsIn(data);
  return presets.length ? { presets } : { error: 'No board found in that file.' };
}

/** A layout is the canvas state: only its known fields are kept, so the endpoint cannot be used to write anything else. */
export function sanitizeLayout(input: unknown): Loose | null {
  if (!isMap(input) || !isMap(input['nodes']) || !Array.isArray(input['edges'])) return null;
  const nodes: Record<string, Loose> = {};
  for (const [key, node] of Object.entries(input['nodes'])) {
    if (!isId(key) || !isObject(node)) continue;
    const changes = node['changes'];
    nodes[key] = {
      x: num(node['x']),
      y: num(node['y']),
      branch: text(node['branch']),
      run: text(node['run'], 16),
      ...(!!node['platform'] && { platform: text(node['platform'], 16) }),
      ...note(node['note']),
      ...(node['hideTunnels'] === true && { hideTunnels: true }),
      ...(['set-aside', 'take-along'].includes(changes as string) && { changes }),
    };
  }
  const edges = cables(input['edges']).map(edge => ({
    from: edge['from'],
    to: edge['to'],
    fromSide: text(edge['fromSide'], 8),
    toSide: text(edge['toSide'], 8),
    ...(slot(edge['fromSlot']) !== null && { fromSlot: edge['fromSlot'] }),
    ...(slot(edge['toSlot']) !== null && { toSlot: edge['toSlot'] }),
    ...(shift(edge['fromShift']) !== null && { fromShift: edge['fromShift'] }),
    ...(shift(edge['toShift']) !== null && { toShift: edge['toShift'] }),
    ...(waypoints(edge['points']) && { points: waypoints(edge['points']) }),
  }));
  // Where tunnel, queue and outside cards sit, keyed by tunnel:<host>:<port>, queue:<id> or outside:<id>.
  const infra = Object.fromEntries(
    Object.entries(isMap(input['infra']) ? input['infra'] : {})
      .filter(([key, at]) => CARD.test(key) && isObject(at))
      .slice(0, 100)
      .map(([key, at]) => [key, xy(at)]),
  );
  const presets = sanitizePresets(input['presets']);
  // Recently deleted boards, newest first, each with when it was deleted.
  const trash = listOf(input['trash'])
    .slice(0, 20)
    .flatMap(deleted => {
      const [preset] = sanitizePresets([deleted]);
      const when = fieldsOf(deleted)['deleted'];
      return preset && typeof when === 'string' && WHEN.test(when) ? [{ ...preset, deleted: when }] : [];
    });
  // The boards opened lately, newest first, each with when.
  const recent = listOf(input['recent'])
    .map(fieldsOf)
    .filter(({ name, at }) => typeof name === 'string' && name && typeof at === 'string' && WHEN.test(at))
    .slice(0, 20)
    .map(({ name, at }) => ({ name: text(name, 80), at }));
  const dismissed = listOf(input['dismissed'])
    .filter(one => typeof one === 'string')
    .slice(0, 200)
    .map(one => one.slice(0, 400));
  // The queues run locally instead of the deployed ones, and the queues taken off the board.
  const chosen = (given: unknown, value: unknown) =>
    Object.fromEntries(
      Object.entries(isMap(given) ? given : {})
        .filter(([key, has]) => isId(key) && has === value)
        .slice(0, 200),
    );
  const queues = chosen(input['queues'], 'local');
  const hiddenQueues = chosen(input['hiddenQueues'], true);
  const { keptLive, tidy, preset } = input;
  const pan = fieldsOf(input['pan']);
  return {
    env: text(input['env'], 8),
    mode: text(input['mode'], 8),
    ...(dismissed.length && { dismissed }),
    ...(typeof keptLive === 'string' && /^[a-z0-9]{6,40}$/.test(keptLive) && { keptLive }),
    ...(Object.keys(infra).length && { infra }),
    ...(Object.keys(queues).length && { queues }),
    ...(Object.keys(hiddenQueues).length && { hiddenQueues }),
    ...(TIDY.includes(tidy as string) && { tidy }),
    ...(input['scratch'] === true && { scratch: true }),
    ...(presets.length && { presets }),
    ...(trash.length && { trash }),
    ...(recent.length && { recent }),
    ...(typeof preset === 'string' && preset && { preset: text(preset, 80) }),
    ...note(input['note']),
    zoom: num(input['zoom']) || 1,
    pan: { x: num(pan['x']), y: num(pan['y']) },
    nodes,
    edges,
  };
}

const PROMPT_TAGS = new Set(['koppler', 'koppler-stop', 'koppler-reply', 'koppler-fix', 'koppler-facts']);
/** A prompt from the standalone page: only the canvas's own kinds, with a bounded text and data object. */
export function sanitizePrompt(input: unknown): Prompt | null {
  const { tag, text: said, data } = fieldsOf(input);
  if (typeof tag !== 'string' || !PROMPT_TAGS.has(tag) || typeof said !== 'string') return null;
  return { tag, text: said.slice(0, 20000), data: isMap(data) ? data : {}, at: new Date().toISOString() };
}
