import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: { fs: { allow: ['..'] } },
  // The page is served from this machine, never downloaded over a network: one chunk this size costs nothing.
  // A warning fails the build, and plugin timings only say the machine was busy.
  build: { chunkSizeWarningLimit: 1024, rolldownOptions: { checks: { bundlerTimings: false } } },
});
