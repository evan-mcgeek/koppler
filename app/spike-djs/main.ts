// The diagram-js spike's page: the same made-up stack. `?cards=60` makes a big board for timing redraws.
import { mount } from 'svelte';
import '../src/fonts/fonts.css';
import '../spike/tokens.css';
import '../spike/page.css';
import App from './App.svelte';
import type { Point, Side } from '../src/core/arrange.ts';

const cable = (from: string, to: string, fromSide: Side, toSide: Side, points?: Point[]) => ({
  from,
  to,
  fromSide,
  toSide,
  ...(points && { points }),
});

const card = (id: string, name: string, kind: string, port: number, x: number, y: number) => ({
  id,
  name,
  kind,
  branch: 'main',
  port,
  x,
  y,
});
const many = Number(new URLSearchParams(location.search).get('cards'));
const cards = many
  ? Array.from({ length: many }, (_, at) =>
      card(`app${String(at)}`, `App ${String(at)}`, 'node', 3000 + at, (at % 10) * 340, Math.floor(at / 10) * 260),
    )
  : [
      card('mobile', 'Mobile App', 'flutter', 0, 0, 0),
      card('web', 'Web Shop', 'node', 3000, 380, 0),
      card('orders', 'Orders API', 'dotnet', 5001, 190, 260),
      card('payments', 'Payments API', 'dotnet', 5002, 0, 520),
      card('catalog', 'Catalog API', 'node', 5003, 380, 520),
    ];
const links = many
  ? cards.flatMap((from, at) =>
      [at + 1, at + 10, at + 11].flatMap(to =>
        to < many ? [cable(from.id, `app${String(to)}`, 'bottom', 'top')] : [],
      ),
    )
  : [
      cable('mobile', 'orders', 'bottom', 'top'),
      cable('web', 'orders', 'bottom', 'top'),
      cable('orders', 'payments', 'bottom', 'top'),
      cable('orders', 'catalog', 'bottom', 'top'),
      cable('web', 'catalog', 'right', 'right', [{ x: 760, y: 330 }]),
    ];
const target = document.getElementById('app');
if (target) mount(App, { target, props: { cards, links } });
