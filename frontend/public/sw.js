// Service worker do app instalável. Só guarda a "casca" do app (HTML, JS, CSS, ícones)
// para abrir rápido com sinal fraco. Dados da API nunca ficam em cache: o backend
// está em outro domínio e as chamadas passam direto para a rede.
const CACHE = 'diane-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Páginas: rede primeiro, para o entregador sempre pegar a versão nova após um deploy;
  // sem rede, abre a última versão guardada.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); return res; })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Arquivos estáticos do build têm hash no nome: o que estiver guardado vale.
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
      return res;
    })),
  );
});
