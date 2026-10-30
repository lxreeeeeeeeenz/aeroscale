import { api, state, refreshMeta, html, mount, icon, $, toastError, esc } from './core.js';

const NAV = [
  { id: 'painel', label: 'Painel', ico: 'gauge' },
  { id: 'gerador', label: 'Gerar escala', ico: 'wand' },
  { id: 'escalas', label: 'Escalas', ico: 'strips' },
  { id: 'calendario', label: 'Calendário', ico: 'calendar' },
  { id: 'meteorologia', label: 'Meteorologia', ico: 'cloud' },
  { id: 'previsoes', label: 'Previsões', ico: 'chart' },
  { id: 'webeye', label: 'IVAO Webeye', ico: 'radar' },
  { sep: true },
  { id: 'frota', label: 'Frota', ico: 'tail' },
  { id: 'adsb', label: 'Dados ADS-B', ico: 'signal' },
  { id: 'importacoes', label: 'Importar RPL', ico: 'inbox' },
  { id: 'voos', label: 'Voos do RPL', ico: 'route' },
  { sep: true },
  { id: 'configuracoes', label: 'Configurações', ico: 'gear' },
];

const VIEWS = {
  painel: () => import('./views/dashboard.js'),
  gerador: () => import('./views/generator.js'),
  escalas: () => import('./views/schedules.js'),
  calendario: () => import('./views/calendar.js'),
  frota: () => import('./views/fleet.js'),
  importacoes: () => import('./views/imports.js'),
  voos: () => import('./views/flights.js'),
  configuracoes: () => import('./views/settings.js'),
  meteorologia: () => import('./views/weather.js'),
  previsoes: () => import('./views/predict.js'),
  webeye: () => import('./views/webeye.js'),
  adsb: () => import('./views/adsb.js'),
  briefing: () => import('./views/briefing.js'),
};

let cleanup = null;
let navToken = 0;

function drawNav(active) {
  const flags = state.meta?.open_flags || 0;
  mount($('#nav'), NAV.map((n) => n.sep ? html`<div class="nav-sep"></div>` : html`<a href="#/${n.id}" class="${active === n.id ? 'active' : ''}" ${active === n.id ? html`aria-current="page"` : ''}>${icon(n.ico)}<span>${n.label}</span>${n.id === 'frota' && flags ? html`<span class="badge warn" title="Pendências de revisão">${flags}</span>` : ''}</a>`));
  const m = state.meta;
  if (!m) return;
  const cov = m.airlines.filter((a) => a.coverage);
  mount($('#rail-foot'), html`
    <div>${cov.length ? html`RPL ativo: ${cov.map((a) => a.code).join(', ')}` : html`<span style="color:var(--warn)">Nenhum RPL importado</span>`}</div>
    ${cov[0] ? html`<div>Validade ${cov[0].coverage.from.split('-').reverse().slice(0, 2).join('/')} a ${cov[0].coverage.to.split('-').reverse().join('/')}</div>` : ''}
    <div><span class="dot" style="background:${m.google.connected ? 'var(--real)' : '#4A5767'}"></span>Google Calendar ${m.google.connected ? 'conectado' : 'desconectado'}</div>`);
}

async function route() {
  const token = ++navToken;
  const hash = location.hash.replace(/^#\/?/, '') || 'painel';
  const [path] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const id = VIEWS[parts[0]] ? parts[0] : 'painel';
  drawNav(id === 'briefing' ? 'escalas' : id);
  $('#rail').classList.remove('open');
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  const view = $('#view');
  mount(view, html`<div class="skeleton" style="height:42px;width:320px"></div><div class="skeleton"></div><div class="skeleton"></div>`);
  try {
    const mod = await VIEWS[id]();
    if (token !== navToken) return;
    const c = await mod.render(view, parts.slice(1));
    if (token !== navToken) { c?.(); return; }
    cleanup = c || null;
    document.title = `${id === 'briefing' ? 'Briefing' : NAV.find((n) => n.id === id)?.label || 'AeroScale'} · AeroScale`;
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    mount(view, html`<div class="notice err">${icon('alert')}<div><b>Não foi possível abrir esta tela.</b><br>${e.message}</div></div>`);
  }
}

// ------------------------------------------------------------------ relógios
function tick() {
  const n = new Date();
  const utc = `${String(n.getUTCHours()).padStart(2, '0')}:${String(n.getUTCMinutes()).padStart(2, '0')}`;
  $('#clock-utc').textContent = utc;
  $('#clock-local').textContent = n.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

// ------------------------------------------------------------------ busca global
function setupSearch() {
  const inp = $('#search-input'), box = $('#search-results');
  mount($('.search-ico'), icon('search'));
  let timer, sel = -1, items = [];
  const close = () => { box.hidden = true; sel = -1; };
  const draw = () => {
    if (!items.length) { mount(box, html`<div class="muted" style="padding:10px">Nada encontrado para "${inp.value}".</div>`); box.hidden = false; return; }
    mount(box, items.map((r, i) => html`<a href="${r.target}" class="${i === sel ? 'sel' : ''}" role="option"><span class="kind">${r.kind}</span><span>${r.label}</span><span class="sub">${r.sub}</span></a>`));
    box.hidden = false;
  };
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (q.length < 2) { close(); return; }
    timer = setTimeout(async () => {
      try { items = (await api('/search?q=' + encodeURIComponent(q))).results; sel = -1; draw(); } catch (e) { toastError(e); }
    }, 180);
  });
  inp.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[Math.max(sel, 0)]) { location.hash = items[Math.max(sel, 0)].target; close(); inp.blur(); }
    if (e.key === 'Escape') close();
  });
  box.addEventListener('click', () => { close(); inp.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('#search')) close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inp.focus(); inp.select(); }
  });
}

// Calendário semanal: rola até o início da manhã ao aparecer
new MutationObserver(() => {
  document.querySelectorAll('[data-autoscroll]').forEach((n) => { n.scrollTop = +n.dataset.autoscroll; n.removeAttribute('data-autoscroll'); });
}).observe(document.body, { childList: true, subtree: true });

async function boot() {
  mount($('#menu-btn'), icon('menu'));
  $('#menu-btn').addEventListener('click', () => $('#rail').classList.toggle('open'));
  setupSearch();
  tick(); setInterval(tick, 15000);
  try { await refreshMeta(); } catch (e) {
    mount($('#view'), html`<div class="notice err">${icon('alert')}<div><b>Servidor indisponível.</b> ${esc(e.message)}</div></div>`);
    return;
  }
  document.addEventListener('meta', () => drawNav((location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || 'painel'));
  window.addEventListener('hashchange', route);
  route();
}

boot();
