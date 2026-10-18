// The new canvas: the page's styles and its one component.
import { mount } from 'svelte';
import '@xyflow/svelte/dist/style.css';
import '../src/fonts/fonts.css';
import './tokens.css';
import './page.css';
import App from './App.svelte';
import { debug } from './debug.svelte.ts';

debug.watch();

// Cards are measured as they first draw: in the page's own faces, so nothing shifts when they arrive.
const FACES = ['400 12px Barlow', '600 12px Barlow', "600 12px 'Barlow Semi Condensed'", "400 12px 'Sometype Mono'"];
await Promise.all(FACES.map(face => document.fonts.load(face))).catch(() => undefined);

const target = document.getElementById('app');
if (target) mount(App, { target });
