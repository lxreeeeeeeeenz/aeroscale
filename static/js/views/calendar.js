import { api, html, mount, icon, state, $, toastError, isoDate, legend, qs } from '../core.js';
import { calendarHTML, calendarTitle, calendarRange, shiftAnchor, showLegModal, stripHTML } from '../legs.js';
import { openModal, fmtDate } from '../core.js';

export async function render(el) {
  const p = qs();
  let mode = p.get('modo') === 'semana' ? 'week' : 'month';
  let anchor = p.get('data') || isoDate(new Date());
  let filters = { airline: '', aircraft_id: '', schedule_id: '' };
  let legs = [];
  const [{ items: schedules }, { items: aircraft }] = await Promise.all([api('/schedules'), api('/aircraft?status=all')]);

  mount(el, html`
    <div class="page-head"><div><h1>Calendário</h1><p class="lead">Todas as pernas escaladas, por data local de partida.</p></div></div>
    <div class="panel">
      <div class="cal-toolbar">
        <button class="btn sm" data-nav="-1" aria-label="Anterior">‹</button>
        <button class="btn sm" data-nav="0">Hoje</button>
        <button class="btn sm" data-nav="1" aria-label="Próximo">›</button>
        <span class="title" id="cal-title"></span>
        <div class="seg"><button data-mode="month">Mês</button><button data-mode="week">Semana</button></div>
        <span class="spacer"></span>
        <select class="input sm" id="f-airline" style="width:auto"><option value="">Todas as cias</option>${state.meta.airlines.map((a) => html`<option value="${a.code}">${a.code}</option>`)}</select>
        <select class="input sm" id="f-ac" style="width:auto"><option value="">Todas as matrículas</option>${aircraft.map((a) => html`<option value="${a.id}">${a.registration}</option>`)}</select>
        <select class="input sm" id="f-s" style="width:auto;max-width:260px"><option value="">Todas as escalas</option>${schedules.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>
      </div>
      <div id="cal-body"></div>
      <div style="margin-top:12px">${legend()}</div>
    </div>`);

  async function load() {
    const [a, b] = calendarRange(mode, anchor);
    const q = new URLSearchParams({ from: a, to: b, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    let reserves = [];
    try { const r = await api('/calendar?' + q); legs = r.legs; reserves = r.reserves || []; } catch (e) { toastError(e); legs = []; }
    $('#cal-title', el).textContent = calendarTitle(mode, anchor);
    el.querySelectorAll('[data-mode]').forEach((b2) => b2.classList.toggle('on', b2.dataset.mode === mode));
    mount($('#cal-body', el), calendarHTML({ mode, anchor, legs, reserves }));
  }

  el.onclick = (e) => {
    const n = e.target.closest('[data-nav]');
    if (n) { anchor = +n.dataset.nav === 0 ? isoDate(new Date()) : shiftAnchor(mode, anchor, +n.dataset.nav); load(); return; }
    const m = e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; load(); return; }
    const ev = e.target.closest('.cal-ev[data-leg], .blk[data-leg]');
    if (ev) { const l = legs.find((x) => String(x.id) === ev.dataset.leg); if (l) showLegModal(l, html`<a class="btn sm" data-close href="#/escalas/${l.schedule_id}">Abrir escala</a>`); return; }
    const more = e.target.closest('.cal-more');
    if (more) openModal({ title: fmtDate(more.dataset.day, { weekday: true }), wide: true, body: html`<div class="stack">${legs.filter((l) => l.local_date === more.dataset.day).map((l) => html`${stripHTML(l, { actions: false, showChecks: false })}<div class="small muted" style="margin:-6px 0 6px 10px">${l.schedule_name}</div>`)}</div>` });
  };
  el.onchange = (e) => {
    if (e.target.id === 'f-airline') filters.airline = e.target.value;
    if (e.target.id === 'f-ac') filters.aircraft_id = e.target.value;
    if (e.target.id === 'f-s') filters.schedule_id = e.target.value;
    load();
  };
  await load();
  return () => { el.onclick = null; el.onchange = null; };
}
