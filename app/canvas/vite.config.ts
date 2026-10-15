import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: { fs: { allow: ['..'] } },
  // The page is served from this machine, never downloaded over a network: one chunk this size costs nothing.
  build: { chunkSizeWarningLimit: 1024 },
});
