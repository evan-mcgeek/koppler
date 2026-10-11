// The new canvas, so far: a made-up stack on the board. `?cards=60` makes a big board for timing redraws.
import { mount } from 'svelte';
import '@xyflow/svelte/dist/style.css';
import '../src/fonts/fonts.css';
import './tokens.css';
import './page.css';
import App from './App.svelte';
import { board, cable, type CardNode } from './board.svelte.ts';

const card = (id: string, name: string, kind: string, port: number, x: number, y: number): CardNode => ({
  id,
  type: 'app',
  position: { x, y },
  data: { name, kind, branch: 'main', port },
});
const many = Number(new URLSearchParams(location.search).get('cards'));
if (many) {
  board.nodes = Array.from({ length: many }, (_, at) =>
    card(`app${String(at)}`, `App ${String(at)}`, 'node', 3000 + at, (at % 10) * 340, Math.floor(at / 10) * 260),
  );
  board.edges = board.nodes.flatMap((node, at) =>
    [at + 1, at + 10, at + 11].flatMap(to =>
      to < many ? [cable(node.id, `app${String(to)}`, { fromSide: 'bottom', toSide: 'top' })] : [],
    ),
  );
} else {
  board.nodes = [
    card('mobile', 'Mobile App', 'flutter', 0, 0, 0),
    card('web', 'Web Shop', 'node', 3000, 380, 0),
    card('orders', 'Orders API', 'dotnet', 5001, 190, 260),
    card('payments', 'Payments API', 'dotnet', 5002, 0, 520),
    card('catalog', 'Catalog API', 'node', 5003, 380, 520),
  ];
  board.edges = [
    cable('mobile', 'orders', { fromSide: 'bottom', toSide: 'top' }),
    cable('web', 'orders', { fromSide: 'bottom', toSide: 'top' }),
    cable('orders', 'payments', { fromSide: 'bottom', toSide: 'top' }),
    cable('orders', 'catalog', { fromSide: 'bottom', toSide: 'top' }),
    cable('web', 'catalog', { fromSide: 'right', toSide: 'right', points: [{ x: 760, y: 330 }] }),
  ];
}
const target = document.getElementById('app');
if (target) mount(App, { target });
