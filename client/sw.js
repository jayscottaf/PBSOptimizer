self.addEventListener('install', (event) => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

// Stage 2: Static asset caching (stale-while-revalidate)
const STATIC_CACHE = 'static-v1';
const ASSET_PATTERN = /\.(css|js|woff2?|ttf|eot|png|jpg|jpeg|svg|webp)$/i;

self.addEventListener('fetch', (event) => {
	const req = event.request;

	// Only same-origin GET requests
	if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

	// Cache static assets
	if (ASSET_PATTERN.test(req.url)) {
		event.respondWith(
			caches.open(STATIC_CACHE).then(async (cache) => {
				const cached = await cache.match(req);
				const fetchPromise = fetch(req).then((res) => {
					if (res && res.status === 200) cache.put(req, res.clone());
					return res;
				}).catch(() => cached);
				return cached || fetchPromise;
			})
		);
	}
});

