// Stage 6: Service Worker Update Strategy & Cache Management
const SW_VERSION = '1.3.0'; // Increment this when making breaking changes
const STATIC_CACHE = `static-v${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-v${SW_VERSION}`;
const ASSET_PATTERN = /\.(css|js|woff2?|ttf|eot|png|jpg|jpeg|svg|webp)$/i;

// List of cache names to keep (others will be deleted)
const CACHE_WHITELIST = [STATIC_CACHE, RUNTIME_CACHE];

// console.log(`Service Worker ${SW_VERSION} installing...`); // Reduced logging

self.addEventListener('install', event => {
  // console.log(`SW ${SW_VERSION}: Install event`); // Reduced logging

  event.waitUntil(
    (async () => {
      // Pre-cache critical assets
      const cache = await caches.open(STATIC_CACHE);
      const criticalAssets = [
        '/',
        '/manifest.webmanifest',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ];

      try {
        await cache.addAll(criticalAssets);
        console.log(`SW ${SW_VERSION}: Critical assets cached`);
      } catch (error) {
        console.warn(
          `SW ${SW_VERSION}: Failed to cache some critical assets:`,
          error
        );
      }

      // Force immediate activation
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  // console.log(`SW ${SW_VERSION}: Activate event`); // Reduced logging

  event.waitUntil(
    (async () => {
      // Clean up old caches
      const cacheNames = await caches.keys();
      const deletePromises = cacheNames
        .filter(name => !CACHE_WHITELIST.includes(name))
        .map(name => {
          // console.log(`SW ${SW_VERSION}: Deleting old cache:`, name); // Reduced logging
          return caches.delete(name);
        });

      await Promise.all(deletePromises);
      console.log(`SW ${SW_VERSION}: Cache cleanup complete`);

      // Take control of all clients immediately
      await self.clients.claim();

      // Notify all clients about the update
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'SW_UPDATED',
          version: SW_VERSION,
          timestamp: Date.now(),
        });
      });

      console.log(`SW ${SW_VERSION}: Activation complete`);
    })()
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Static assets: Cache-first with stale-while-revalidate
  if (ASSET_PATTERN.test(req.url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async cache => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then(res => {
            if (res && res.status === 200) {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached); // Fallback to cache if network fails

        return cached || fetchPromise;
      })
    );
    return;
  }

  // App shell (HTML): Network-first with cache fallback
  if (
    url.pathname === '/' ||
    req.headers.get('accept')?.includes('text/html')
  ) {
    event.respondWith(
      fetch(req)
        .then(response => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => {
              cache.put(req, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(req);
        })
    );
    return;
  }

  // API requests: Network-first, no cache for dynamic data
  if (url.pathname.startsWith('/api/')) {
    // Let API requests go to network directly
    // IndexedDB handles the offline caching for data
    return;
  }
});

// Handle messages from the main thread
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'CHECK_VERSION':
      // Use ports if available (MessageChannel), otherwise use source
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({
          type: 'VERSION_RESPONSE',
          version: SW_VERSION,
        });
      } else if (event.source) {
        event.source.postMessage({
          type: 'VERSION_RESPONSE',
          version: SW_VERSION,
        });
      }
      break;

    case 'FORCE_UPDATE':
      // Force update by clearing caches and reloading
      caches
        .keys()
        .then(names => {
          return Promise.all(names.map(name => caches.delete(name)));
        })
        .then(() => {
          return self.clients.matchAll();
        })
        .then(clients => {
          clients.forEach(client => {
            if (client.url) {
              client.navigate(client.url);
            }
          });
        })
        .catch(error => {
          console.error('SW: Force update failed:', error);
        });
      break;

    case 'SKIP_WAITING':
      // Skip waiting and take control immediately
      self.skipWaiting();
      break;

    default:
      console.log(`SW ${SW_VERSION}: Unknown message type:`, type);
  }
});
