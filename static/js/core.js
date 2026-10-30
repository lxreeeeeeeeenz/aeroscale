// Utilitários compartilhados: API, HTML seguro, ícones, formatação, modal e toasts.

export const state = { meta: null };

// ------------------------------------------------------------------ API
export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch('/api' + path, init);
  } catch (e) {
    throw new Error('Sem conexão com o servidor do AeroScale. Ele está rodando?');
  }
  let data = null;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { error: txt.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.data = data; err.status = res.status;
    throw err;
  }
  return data;
}

export async function refreshMeta() {
  state.meta = await api('/meta');
  document.dispatchEvent(new CustomEvent('meta'));
  return state.meta;
}

// ------------------------------------------------------------------ HTML
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += render(vals[i]);
  });
  return raw(out);
}
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}
export function mount(el, content) { el.innerHTML = Array.isArray(content) ? content.map(render).join('') : String(content); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ ícones (traço 24px)
const P = {
  plane: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
  takeoff: '<path d="M2 22h20"/><path d="M6.4 17.6 3 14.3l1.8-1 3 1.6 3.4-2-5-4.1 2-1.1 7 2.9 3.5-2a2 2 0 0 1 2 3.4l-12 6.8a2 2 0 0 1-2.3-.2z"/>',
  landing: '<path d="M2 22h20"/><path d="m3.8 9.7 1.6-.9 2.8 2.2 3.7.9-1.7-6.2 2-.4 4 6.5 3.8 1a2 2 0 0 1-1 3.9L5.5 14a2 2 0 0 1-1.4-1.4z"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/><circle cx="12" cy="14" r="1.2"/>',
  wand: '<path d="M15 4V2M15 10V8M11 6h2M17 6h2"/><path d="m3 21 11-11"/><path d="m12.5 11.5 1.5-1.5"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  tail: '<path d="M4 20h16"/><path d="M6 20 9 4h3l4 9h4l-1.5 7"/><path d="M10.5 9h3"/>',
  inbox: '<path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M4 3h16"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-4.2L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.8 4.2L21 15"/><path d="M21 20v-5h-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.2v.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.3"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-2"/><path d="m17 20 4-4-4-4"/>',
  insert: '<path d="M12 5v8M8 9h8"/><path d="M4 19h16"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4"/><path d="M17 20V4M13 8l4-4 4 4"/>',
  cards: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
  strips: '<rect x="3" y="4" width="18" height="4.5" rx="1"/><rect x="3" y="10" width="18" height="4.5" rx="1"/><rect x="3" y="16" width="18" height="4.5" rx="1"/><path d="M6 4v4.5M6 10v4.5M6 16v4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  power: '<path d="M12 3v9"/><path d="M6.4 7a8 8 0 1 0 11.2 0"/>',
  tower: '<path d="M9 21l1-10h4l1 10M8 7h8l-1.5 4h-5zM12 3v4M7 21h10"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4z"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.5 5.5"/><circle cx="12" cy="12" r="1"/>',
  signal: '<path d="M5 12.5a7 7 0 0 1 14 0"/><path d="M8.5 13a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="14" r="1.2"/><path d="M12 15.5V21"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`);

// ------------------------------------------------------------------ formatação
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTHS_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEK_LETTERS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
export const WEEK_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

export function parseISODate(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function fmtDate(s, opts = {}) {
  if (!s) return '—';
  const d = parseISODate(s);
  const base = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (opts.weekday) return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
  return opts.year === false ? base : `${base}/${d.getFullYear()}`;
}
export function fmtDur(min) {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}
export const hhmm = (iso) => (iso || '').slice(11, 16);

// Horário de uma perna conforme a preferência (local do aeroporto ou UTC)
export function legTime(l, which) {
  const utc = state.meta?.settings?.display_tz === 'utc';
  if (which === 'dep') return utc ? { t: hhmm(l.dep_utc), z: 'Z', alt: `${hhmm(l.dep_local)} ${l.dep_off}` } : { t: hhmm(l.dep_local), z: l.dep_off === 'UTC' ? 'Z' : 'L', alt: `${hhmm(l.dep_utc)}Z` };
  return utc ? { t: hhmm(l.arr_utc), z: 'Z', alt: `${hhmm(l.arr_local)} ${l.arr_off}` } : { t: hhmm(l.arr_local), z: l.arr_off === 'UTC' ? 'Z' : 'L', alt: `${hhmm(l.arr_utc)}Z` };
}

export const ORIGIN = {
  REAL: { label: 'Real', long: 'Voo real do RPL', cls: 'real', color: 'var(--real)' },
  PROJETADO: { label: 'Projetado', long: 'Projetado do padrão semanal (não garantido)', cls: 'proj', color: 'var(--proj)' },
  SUGESTAO: { label: 'Sugestão', long: 'Sugestão do sistema (sem voo no RPL)', cls: 'sugg', color: 'var(--sugg)' },
  MANUAL: { label: 'Manual', long: 'Inserido ou alterado manualmente', cls: 'manual', color: 'var(--manual)' },
};
export const originBadge = (o) => html`<span class="badge ${ORIGIN[o]?.cls || ''}" title="${ORIGIN[o]?.long || o}">${ORIGIN[o]?.label || o}</span>`;
export function airline(code) { return (state.meta?.airlines || []).find((a) => a.code === code) || { code, name: code, color: '#9AA7B5' }; }
export const airlineTag = (code) => { const a = airline(code); return html`<span class="airline-tag" title="${a.name}"><span class="swatch" style="background:${a.color}"></span>${code}</span>`; };
export const triPill = (v) => {
  if (v === 'SIM') return html`<span class="tri sim">SIM</span>`;
  if (v === 'NÃO') return html`<span class="tri nao">NÃO</span>`;
  return html`<span class="tri desc" title="Desconhecido – não confirmado">?</span>`;
};
export const legend = () => html`<div class="legend">${Object.entries(ORIGIN).map(([k, o]) => html`<span><span class="swatch" style="background:${o.color}"></span>${o.long}</span>`)}</div>`;

// ------------------------------------------------------------------ toasts
export function toast(msg, kind = 'ok', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = String(html`${icon(kind === 'err' ? 'alert' : kind === 'warn' ? 'alert' : kind === 'info' ? 'info' : 'check')}<div>${msg}</div>`);
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
export function toastError(e) { toast(e?.message || String(e), 'err', 7000); }

// ------------------------------------------------------------------ modal / gaveta
export function openModal({ title, body, foot = '', wide = false, drawer = false, onMount, onClose }) {
  const root = document.getElementById('modal-root');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = String(html`<div class="${drawer ? 'drawer' : `modal${wide ? ' wide' : ''}`}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head"><h2>${title}</h2><button class="icon-btn x" data-close aria-label="Fechar">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? html`<div class="modal-foot">${foot}</div>` : ''}
  </div>`);
  const prevFocus = document.activeElement;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(ov);
  const box = ov.firstElementChild;
  (box.querySelector('input,select,textarea,button:not([data-close])') || box).focus?.();
  onMount?.(box, close);
  return { el: box, close };
}

export function confirmDialog(message, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: 'Confirmar ação', body: html`<p class="text-2" style="max-width:56ch">${message}</p>`,
      foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${ok}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

export async function withBusy(btn, fn) {
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try { return await fn(); } finally { if (btn) { btn.classList.remove('loading'); btn.disabled = false; } }
}

export function download(url) {
  const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
}

export function qs() {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
}

export function chipsInput(el, values = [], { pattern = /^[A-Z]{4}$/, placeholder = 'ICAO + Enter' } = {}) {
  let vals = [...values];
  const draw = () => {
    el.innerHTML = String(html`${vals.map((v, i) => html`<span class="chip">${v}<button type="button" data-i="${i}" aria-label="Remover ${v}">×</button></span>`)}<input placeholder="${placeholder}" list="ap-list" aria-label="Adicionar aeroporto">`);
    const inp = el.querySelector('input');
    inp.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && inp.value.trim()) {
        e.preventDefault();
        const v = inp.value.trim().toUpperCase();
        if (!pattern.test(v)) { toast(`"${v}" não é um código ICAO de 4 letras.`, 'warn'); return; }
        if (!vals.includes(v)) vals.push(v);
        draw(); el.querySelector('input').focus();
      } else if (e.key === 'Backspace' && !inp.value && vals.length) { vals.pop(); draw(); el.querySelector('input').focus(); }
    });
    inp.addEventListener('change', () => { const v = inp.value.trim().toUpperCase(); if (pattern.test(v) && !vals.includes(v)) { vals.push(v); draw(); } });
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { vals.splice(+b.dataset.i, 1); draw(); } });
  draw();
  return { get: () => vals, set: (v) => { vals = [...v]; draw(); } };
}
