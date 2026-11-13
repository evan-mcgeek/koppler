// An exported page: Discover to read, its data inside the page, so it opens from a file with no network.
import { mount } from 'svelte';
import '@xyflow/svelte/dist/style.css';
import '../../src/fonts/fonts.css';
import '../tokens.css';
import '../page.css';
import type { Exported } from '../../src/core/export.ts';
import type { Registry } from '../../src/data.ts';
import { appearance } from '../appearance.svelte.ts';
import { board } from '../board.svelte.ts';
import ViewOnly from './ViewOnly.svelte';

const given = document.getElementById('flows')?.textContent;
const data = given ? (JSON.parse(given) as Exported) : null;
const target = document.getElementById('app');
if (target && data) {
  if (data.scheme) appearance.openIn(data.scheme);
  board.viewOnly = true;
  board.open({ stack: data.facts as Registry, clones: {}, roots: [], saved: data.env ? { env: data.env } : null });
  const first = data.boards[0];
  if (first) board.openBoard(first);
  board.discovering = true;
  // Cards are measured as they first draw: in the page's own faces, so nothing shifts when they arrive.
  const FACES = ['400 12px Barlow', '600 12px Barlow', "600 12px 'Barlow Semi Condensed'", "400 12px 'Sometype Mono'"];
  await Promise.all(FACES.map(face => document.fonts.load(face))).catch(() => undefined);
  mount(ViewOnly, { target, props: { data } });
}
