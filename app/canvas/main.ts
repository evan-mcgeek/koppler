// The new canvas: the page's styles and its one component.
import { mount } from 'svelte';
import '@xyflow/svelte/dist/style.css';
import '../src/fonts/fonts.css';
import './tokens.css';
import './page.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (target) mount(App, { target });
