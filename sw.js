const CACHE_NAME = 'shouhi-quiz-v26';
const STATIC_FILES = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './data-loader.js',
  './storage.js',
  './quiz-engine.js',
  './modes.js',
  './stats-view.js',
  './essay.js',
  './app.js',
  './icon.svg',
  './icon-maskable.svg',
  './data/questions.json',
  './data/categories.json',
  './data/essays.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // HTTPキャッシュ（GitHub Pages は max-age=600）を経由すると、公開直後に古いファイルを
      // 取り込むことがあるため、必ずサーバーから取り直す。
      .then((cache) => cache.addAll(STATIC_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname === '/';

  if (isNavigation) {
    // ナビゲーション/index.htmlはnetwork-first。HTTPキャッシュも無視して常に最新を取りに行く
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // その他の同一オリジン静的ファイルはcache-first
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
