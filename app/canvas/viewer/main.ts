// An exported page: the team's flows, to read. Its data comes inside the page, so it opens from a file with no network.
import { mount } from 'svelte';
import '../../src/fonts/fonts.css';
import '../tokens.css';
import type { Exported } from '../../src/core/export.ts';
import Viewer from './Viewer.svelte';

if (matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset['scheme'] = 'paper';
const given = document.getElementById('flows')?.textContent;
const data = given ? (JSON.parse(given) as Exported) : null;
const target = document.getElementById('app');
if (target && data) mount(Viewer, { target, props: { data } });
