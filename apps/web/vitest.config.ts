import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// The plugin turns the runes of the .svelte.ts modules into plain code, so that a test can import them.
export default defineConfig({ plugins: [svelte()], test: { include: ['test/**/*.test.ts'] } });
