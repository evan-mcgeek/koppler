// Arrange's layout: the cards in layers by who calls whom, and each link routed round every card, by ELK's layered
// algorithm. The same map gives the same layout, so routes are worked out again rather than kept.
import type { ELK } from 'elkjs/lib/elk-api.js';
import type { Point, Size } from './arrange.ts';

/** Arrange's layouts, in the order it steps through them. */
export const DIRECTIONS = ['RIGHT', 'DOWN'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export interface Laid {
  /** Each card's top left corner. */
  at: Record<string, Point>;
  /** Each link's route: its start, then Bézier control points in threes, ending on the card it reaches. */
  routes: Record<string, Point[]>;
}

const OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'SPLINES',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeNode': '24',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
};

/** Lays the cards out and routes every link, in one of Arrange's directions, with the ELK engine given. */
export async function layOut(
  cards: (Size & { id: string })[],
  links: { id: string; from: string; to: string }[],
  direction: Direction,
  elk: ELK,
): Promise<Laid> {
  const ids = new Set(cards.map(card => card.id));
  const laid = await elk.layout({
    id: 'map',
    layoutOptions: { ...OPTIONS, 'elk.direction': direction },
    children: cards.map(({ id, w, h }) => ({ id, width: w, height: h })),
    edges: links
      .filter(({ from, to }) => ids.has(from) && ids.has(to) && from !== to)
      .map(({ id, from, to }) => ({ id, sources: [from], targets: [to] })),
  });
  const at = Object.fromEntries((laid.children ?? []).map(({ id, x = 0, y = 0 }) => [id, { x, y }]));
  const routes = Object.fromEntries(
    (laid.edges ?? []).flatMap(edge => {
      const section = edge.sections?.[0];
      if (!section) return [];
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      // Splines come as cubic Béziers, three points to a curve; anything else is drawn through its points.
      return [[edge.id, points.map(({ x, y }) => ({ x, y }))]];
    }),
  );
  return { at, routes };
}

/** A route as an SVG path: Bézier curves when it is one, else smooth through its points. */
export function routePath(points: Point[]): string {
  const at = ({ x, y }: Point) => `${String(Math.round(x * 10) / 10)} ${String(Math.round(y * 10) / 10)}`;
  const [first, ...rest] = points;
  if (!first) return '';
  if (rest.length % 3 === 0)
    return `M${at(first)}${rest.map((point, i) => (i % 3 === 0 ? ` C${at(point)}` : ` ${at(point)}`)).join('')}`;
  return `M${at(first)}${rest.map(point => ` L${at(point)}`).join('')}`;
}

/** A point along a route, `t` from 0 at its start to 1 at its end, for a label on it. */
export function along(points: Point[], t: number): Point {
  const curves = Math.floor((points.length - 1) / 3);
  if (!curves || (points.length - 1) % 3) {
    const a = points[0] ?? { x: 0, y: 0 };
    const b = points.at(-1) ?? a;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const which = Math.min(curves - 1, Math.floor(t * curves));
  const u = t * curves - which;
  const [p0, p1, p2, p3] = points.slice(which * 3, which * 3 + 4) as [Point, Point, Point, Point];
  const v = 1 - u;
  return {
    x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x,
    y: v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y,
  };
}
