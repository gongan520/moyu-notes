/* 墨屿 — service worker（离线可用） */
const CACHE = 'moyu-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/util.js',
  './js/idb.js',
  './js/ink.js',
  './js/htmlpage.js',
  './js/pdf.js',
  './js/library.js',
  './js/studio.js',
  './js/words.js',
  './js/search.js',
  './js/outline.js',
  './js/flashcard.js',
  './js/backup.js',
  './js/record.js',
  './js/pdfimport.js',
  './js/boot.js',
  './assets/icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => { })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isDoc = req.mode === 'navigate' || /\.html?$/.test(url.pathname) || url.pathname.endsWith('/');

  if (isDoc) {
    // 文档：网络优先，失败回缓存
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        }
        return res;
      });
    })
  );
});
