/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = /** @type {ServiceWorkerGlobalScope} */ (
  /** @type {unknown} */ (self)
);

import { build, files, version } from "$service-worker";

// Create a unique cache name for this deployment
const CACHE = `cache-${version}`;

const ASSETS = [
  ...build, // the app itself
  ...files, // everything in `static`
];

sw.addEventListener("install", (event) => {
  // Force the waiting service worker to become the active service worker.
  sw.skipWaiting();

  // Create a new cache and add all files to it
  async function addFilesToCache() {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
  }

  event.waitUntil(addFilesToCache());
});

sw.addEventListener("activate", (event) => {
  // Claim any clients immediately, so the new SW controls the page right away
  sw.clients.claim();

  // Remove previous cached data from disk
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
  }

  event.waitUntil(deleteOldCaches());
});

sw.addEventListener("fetch", (event) => {
  // for GET requests, try the network first, fall back to cache
  if (event.request.method !== "GET") return;

  async function respond() {
    const url = new URL(event.request.url);
    const cache = await caches.open(CACHE);

    // serve build files from the cache
    if (ASSETS.includes(url.pathname)) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }

    // try the network first
    try {
      const response = await fetch(event.request);

      // if we're offline, fetch is going to fail, so we return the cached response
      if (response.status === 200) {
        cache.put(event.request, response.clone());
      }

      return response;
    } catch {
      // if we're offline, return the cached response
      const cached = await cache.match(event.request);
      return cached || new Response("Offline", { status: 503 });
    }
  }

  event.respondWith(respond());
});
