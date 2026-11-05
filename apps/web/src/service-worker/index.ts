import { version } from '$app/environment';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = `urna-abierta-${version}`;
const inScope = (path: string) => new URL(path.replace(/^\//, ''), self.registration.scope).href;
const SHELL = inScope('index.html');
const API = inScope('api/');
const FILES = [...immutable, ...assets].map((file) => inScope(file.path));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...FILES, SHELL])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// A new version waits until the person accepts it, so it never changes during an election.
self.addEventListener('message', (event) => {
  if (event.data === 'update-now') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (request.url.startsWith(API)) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match(SHELL).then((cached) => cached ?? fetch(request)));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
