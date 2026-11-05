import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ fallback: 'index.html', precompress: true }),
      paths: { base: (process.env.BASE_PATH ?? '') as '' | `/${string}` },
      // Registered by hand: an update must never replace the app in the middle of an election.
      serviceWorker: { register: false },
    }),
  ],
});
