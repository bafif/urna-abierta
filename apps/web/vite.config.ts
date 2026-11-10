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
      // The page says which inline script is its own, by its hash: one slipped in through some text does not run, and
      // cannot read this device's credential. Caddy's header still allows inline scripts; both have to agree.
      csp: { mode: 'hash', directives: { 'script-src': ['self'] } },
    }),
  ],
});
