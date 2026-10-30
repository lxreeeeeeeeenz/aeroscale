// Componentes de perna: fita de voo, cartão, calendário mensal/semanal e detalhe.
import { html, icon, esc, legTime, fmtDur, fmtDate, originBadge, ORIGIN, openModal, parseISODate, isoDate, addDays,
  MONTHS_FULL, WEEK_SHORT, mount, state, airlineTag } from './core.js';

const CHECK_ICO = { error: 'alert', warning: 'alert', info: 'info' };

export function stripHTML(l, { actions = true, showChecks = true } = {}) {
  const d = legTime(l, 'dep'), a = legTime(l, 'arr');
  const visibleChecks = (l.checks || []).filter((c) => c.level !== 'info' || ['sugestao', 'manual_confere', 'origem_mudou', 'deslocamento_reserva'].includes(c.code));
  return html`<div class="strip-wrap" data-leg="${l.id}">
    <div class="strip status-${l.status || 'ok'} ${l.activity === 'RESERVA' ? 'act-res' : ''}" data-origin="${l.data_origin}">
      <div class="tab" title="${ORIGIN[l.data_origin]?.long}"></div>
      <div class="ident">
        <span class="fn">${l.flight_number || 'POS'}</span>
        <span class="reg">${l.registration || 'sem matrícula'}${l.type_icao ? ` · ${l.type_icao}` : ''}</span>
        ${(l.checks || []).some((c) => c.code === 'anormalidade_repeticao') ? html`<span class="badge anom" title="Vai-e-volta repetido no mesmo par de aeroportos no dia">Anormalidade</span>` : ''}
        ${l.activity === 'RESERVA' ? html`<span class="badge res" title="Voo do RPL atribuído pelo sorteio de acionamento da reserva (simulado)">Acionamento</span>` : ''}
      </div>
      <div class="route">
        <div class="ap"><span class="code">${l.adep}</span><span class="t">${d.t}<small>${d.z}</small></span><span class="city" title="${l.adep_name || ''}">${l.adep_city || 'aeroporto não cadastrado'}</span></div>
        <div class="path"><span>${icon('plane')}${fmtDur(l.block_min)}</span></div>
        <div class="ap arr"><span class="code">${l.ades}</span><span class="t">${a.t}<small>${a.z}</small></span><span class="city" title="${l.ades_name || ''}">${l.ades_city || 'aeroporto não cadastrado'}</span></div>
      </div>
      <div class="cell"><span>${originBadge(l.data_origin)}</span><span title="Horário alternativo">${d.alt} → ${a.alt}</span></div>
      <div class="cell c-extra"><span>RPL <b>${l.planned_type || '—'}</b></span><span>${l.ref_date ? `ref. ${fmtDate(l.ref_date, { year: false })}` : l.notes ? esc(l.notes).slice(0, 40) : ''}</span></div>
      ${actions ? html`<div class="acts">
        <a class="icon-btn" href="#/briefing/${l.id}" title="Briefing do voo (METAR, sequência, previsão)">${icon('clipboard')}</a>
        ${l.simbrief?.url ? html`<a class="icon-btn sb" href="${l.simbrief.url}" target="_blank" rel="noopener" title="Abrir no SimBrief${l.simbrief.altn ? ` (alternado ${l.simbrief.altn})` : ''}">${icon('send')}</a>` : ''}
        <button class="icon-btn" data-act="replace" title="Substituir por outro voo real">${icon('swap')}</button>
        <button class="icon-btn" data-act="after" title="Inserir voo depois desta perna">${icon('insert')}</button>
        <button class="icon-btn" data-act="regen" title="Regerar a partir desta perna">${icon('refresh')}</button>
        <button class="icon-btn" data-act="more" title="Mais ações">${icon('edit')}</button>
      </div>` : html`<div></div>`}
    </div>
    ${showChecks && visibleChecks.length ? html`<div class="strip-checks">${visibleChecks.map((c) => html`<div class="${c.level}">${icon(CHECK_ICO[c.level] || 'info')}${c.message}</div>`)}</div>` : ''}
  </div>`;
}

function turnHTML(prev, l) {
  if (!prev) return '';
  if (l.adep !== prev.ades) {
    if ((l.checks || []).some((c) => c.code === 'deslocamento_reserva')) return html`<div class="turn">${icon('route')} Deslocamento ${prev.ades} → ${l.adep} ligado à reserva (tripulante em extra)</div>`;
    return html`<div class="turn break">QUEBRA DE CONTINUIDADE: chegou em ${prev.ades}, parte de ${l.adep}</div>`;
  }
  const g = l.ground_before;
  if (g === null || g === undefined) return '';
  if (g < 0) return html`<div class="turn break">Sobreposição de ${fmtDur(-g)}</div>`;
  const minTurn = state.meta?.settings?.min_turn_min || 40;
  const sameDay = !prev.gap_next || ['solo', 'solo_longo', 'parada_noturna_curta', 'solo_curto'].includes(prev.gap_next.kind);
  const mdl = sameDay && prev.model_next && prev.model_next.p != null
    ? html` · <span class="mdl ${prev.model_next.rank === 1 ? 'top' : ''}" title="Probabilidade (modelo de rodízio) de esta perna ser a continuação da anterior: ${prev.model_next.rank}º de ${prev.model_next.n} voos possíveis${prev.model_next.top_ident && prev.model_next.rank !== 1 ? `; mais provável: ${prev.model_next.top_ident} (${Math.round(prev.model_next.top_p * 100)}%)` : ''}">modelo ${Math.round(prev.model_next.p * 100)}%</span>` : '';
  const kind = prev.gap_next?.label;
  if (g >= 6 * 60) return html`<div class="turn night">${icon('clock')} ${kind && kind !== 'Solo normal' ? kind : 'Pernoite'} em ${l.adep} · ${fmtDur(g)} no solo${mdl}</div>`;
  return html`<div class="turn ${g < minTurn ? 'short' : ''}">${kind && !['Solo normal', 'Solo abaixo do mínimo observado'].includes(kind) ? kind : 'Solo'} em ${l.adep} · ${fmtDur(g)}${mdl}</div>`;
}

export function continuationHTML(cont) {
  if (!cont || !cont.length) return '';
  const C = { alta: 'ok', 'média': 'warn', baixa: 'err' };
  return html`<section class="day-group"><div class="day-head"><span class="d">Continuação prevista</span><span class="meta">após a última perna · previsão do modelo, não confirmada</span></div>
    ${cont.map((c) => html`<div class="turn">${c.gap_label} · ${fmtDur(c.ground_min)}</div><div class="strip predicted" data-origin="SUGESTAO">
      <div class="tab"></div><div class="ident"><span class="fn">${c.ident}</span><span class="reg">previsão</span></div>
      <div class="route"><div class="ap"><span class="code">${c.adep}</span><span class="t">${c.dep_local.slice(11, 16)}<small>L</small></span><span class="city">${c.adep_city || ''}</span></div>
        <div class="path"><span>${icon('plane')}</span></div>
        <div class="ap arr"><span class="code">${c.ades}</span><span class="t">${c.arr_local.slice(11, 16)}<small>L</small></span><span class="city">${c.ades_city || ''}</span></div></div>
      <div class="cell"><span class="badge ${C[c.confidence]}">${Math.round(c.p * 100)}% · ${c.confidence}</span><span>acumulada ${Math.round(c.chain_p * 100)}%</span></div>
      <div class="cell c-extra">${c.reasons.filter((r) => r.weight > 0).slice(0, 2).map((r) => html`<span>${r.text}</span>`)}</div><div></div></div>`)}</section>`;
}

const RES_CLS = { acionado: 'res', sem_acionamento: '', inviavel: 'warn', pendente: '' };
export const reserveOf = (reserves, ds) => (reserves || []).find((r) => r.start_date <= ds && ds <= r.end_date) || null;
const dm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

export function reserveHeadHTML(r, { buttons = false } = {}) {
  return html`<div class="res-head">
    <div class="res-title"><span class="res-tag">RESERVA</span><b>${dm(r.start_date)} a ${dm(r.end_date)}</b> <span class="muted">(${r.days} dias)</span></div>
    <div class="res-meta"><span>${icon('tower')} ${r.location_label}${r.location_city ? ` · ${r.location_city}` : ''}</span>
      <span>Acionamento: <span class="badge ${RES_CLS[r.status] || ''}">${r.status_label}</span></span>
      ${r.activated && r.act_start ? html`<span class="muted small">sorteado para ${dm(r.act_start)}${r.act_days > 1 ? ` a ${dm(r.act_end)}` : ''}</span>` : ''}</div>
    ${buttons ? html`<div class="res-actions"><button class="btn sm" data-a="res-redraw" type="button">${icon('refresh')}Novo sorteio da reserva</button></div>` : ''}
  </div>`;
}

export function timelineHTML(legs, { actions = true, dayActions = true, duties = null, continuation = null, reserves = null } = {}) {
  const dutyByDate = new Map((duties || []).map((d) => [d.date, d]));
  reserves = reserves || [];
  if (!legs.length && !reserves.length) return html`<div class="empty"><h3>Escala sem pernas</h3><p>Use "Adicionar perna" ou regere a escala com critérios mais flexíveis.</p></div>`;
  const days = new Map();
  legs.forEach((l) => { if (!days.has(l.local_date)) days.set(l.local_date, []); days.get(l.local_date).push(l); });
  // ordem cronológica: dias normais + um bloco por reserva (as pernas de dentro vão no bloco)
  const items = [];
  for (const d of days.keys()) if (!reserveOf(reserves, d)) items.push({ d, kind: 'day' });
  reserves.forEach((r) => items.push({ d: r.start_date, kind: 'res', r }));
  items.sort((a, b) => a.d.localeCompare(b.d) || (a.kind === 'res' ? -1 : 1));
  let prev = null;
  let afterRes = null;
  const out = [];
  for (const it of items) {
    if (it.kind === 'res') { out.push(reserveBlockHTML(it.r, days, prev, actions)); const inside = legs.filter((l) => l.local_date >= it.r.start_date && l.local_date <= it.r.end_date); prev = inside.length ? inside[inside.length - 1] : null; afterRes = it.r; continue; }
    const d = it.d, ls = days.get(d);
    const block = ls.reduce((s, l) => s + l.block_min, 0);
    const body = ls.map((l) => {
      let t;
      if (afterRes && !(l.checks || []).some((c) => c.code === 'deslocamento_reserva')) t = html`<div class="turn">${icon('clock')} Fim da reserva (${dm(afterRes.end_date)}) · retoma em ${l.adep}</div>`;
      else t = turnHTML(prev, l);
      afterRes = null; prev = l; return html`${t}${stripHTML(l, { actions })}`;
    });
    out.push(html`<section class="day-group">
      <div class="day-head"><span class="d">${fmtDate(d, { weekday: true })}</span><span class="meta">${ls.length} perna(s) · ${fmtDur(block)} de bloco${(() => { const du = dutyByDate.get(d); if (!du) return ''; const bad = du.issues.some((i) => i.level === 'error'); return html` · <span style="color:${bad ? 'var(--err)' : 'inherit'}" title="${du.limit_source}">jornada ${fmtDur(Math.round(du.duty_h * 60))} de ${du.fdp_limit_h}h (apres. ${du.report_local})</span>${du.madrugada ? ' · madrugada' : ''}`; })()}</span>
      ${dayActions ? html`<div class="actions"><button class="btn sm ghost" data-regen-day="${d}">${icon('refresh')}Regerar dia</button></div>` : ''}</div>
      ${body}</section>`);
  }
  return html`${out}${continuationHTML(continuation)}`;
}

function reserveBlockHTML(r, days, prevIn, actions) {
  let prev = prevIn;
  const rows = [];
  let quiet = [];
  const flushQuiet = () => {
    if (!quiet.length) return;
    const a = quiet[0], b = quiet[quiet.length - 1];
    rows.push(html`<div class="res-quiet">${icon('clock')} ${a === b ? dm(a) : `${dm(a)} a ${dm(b)}`} · de reserva em ${r.location_iata}, sem voos</div>`);
    quiet = [];
  };
  const d0 = parseISODate(r.start_date), d1 = parseISODate(r.end_date);
  for (let d = d0; d <= d1; d = addDays(d, 1)) {
    const ds = isoDate(d);
    const ls = days.get(ds) || [];
    if (!ls.length) { quiet.push(ds); continue; }
    flushQuiet();
    rows.push(html`<div class="day-head res-day"><span class="d">${fmtDate(ds, { weekday: true })}</span><span class="meta">${ls.length} perna(s) · acionamento simulado</span></div>`);
    ls.forEach((l) => {
      const first = !prev || prev.local_date < r.start_date;
      const t = first && !(l.checks || []).some((c) => c.code === 'deslocamento_reserva')
        ? html`<div class="turn">${icon('clock')} Acionamento da reserva · apresentação em ${l.adep}</div>` : turnHTML(prev, l);
      rows.push(html`${t}${stripHTML(l, { actions })}`); prev = l;
    });
  }
  flushQuiet();
  return html`<section class="day-group res-block" data-res="${r.id}">${reserveHeadHTML(r)}
    ${r.status === 'inviavel' || r.note ? html`<p class="res-note ${r.status === 'inviavel' ? 'warn' : ''}">${r.note}</p>` : ''}
    ${rows}</section>`;
}

export function cardsHTML(legs) {
  if (!legs.length) return html`<div class="empty"><h3>Nenhuma perna</h3></div>`;
  return html`<div class="cards">${legs.map((l) => {
    const d = legTime(l, 'dep'), a = legTime(l, 'arr');
    return html`<article class="pass" data-origin="${l.data_origin}" data-leg="${l.id}">
      <div class="top"><span class="fn">${l.flight_number || 'POSICIONAMENTO'}</span><span>${fmtDate(l.local_date, { weekday: true })}</span></div>
      <div class="mid">
        <div><div class="code">${l.adep}</div><div class="t">${d.t} <small class="muted">${d.z}</small></div><div class="c">${l.adep_city || '—'}</div></div>
        <div class="plane">${icon('plane')}</div>
        <div class="r"><div class="code">${l.ades}</div><div class="t">${a.t} <small class="muted">${a.z}</small></div><div class="c">${l.ades_city || '—'}</div></div>
      </div>
      <div class="bot"><span>${airlineTag(l.airline)}</span><span>${l.registration || 'sem matrícula'}</span><span>${l.type_icao || ''}</span><span>${fmtDur(l.block_min)}</span>${originBadge(l.data_origin)}</div>
    </article>`;
  })}</div>`;
}

export function showLegModal(l, extra = '') {
  const d = legTime(l, 'dep'), a = legTime(l, 'arr');
  openModal({
    title: `${l.flight_number || 'Posicionamento'} ${l.adep} → ${l.ades}`,
    body: html`<div class="stack">
      <div class="row">${originBadge(l.data_origin)} ${airlineTag(l.airline)} ${l.schedule_name ? html`<span class="badge">${l.schedule_name}</span>` : ''}</div>
      <dl class="kv">
        <dt>Data (local de partida)</dt><dd>${fmtDate(l.local_date, { weekday: true })}</dd>
        <dt>Partida</dt><dd>${l.adep} ${l.adep_city ? `– ${l.adep_city}` : ''} · <b>${d.t}</b> ${d.z === 'L' ? l.dep_off : 'UTC'} (${d.alt})</dd>
        <dt>Chegada</dt><dd>${l.ades} ${l.ades_city ? `– ${l.ades_city}` : ''} · <b>${a.t}</b> ${a.z === 'L' ? l.arr_off : 'UTC'} (${a.alt})</dd>
        <dt>Tempo de bloco</dt><dd>${fmtDur(l.block_min)} (EET ${fmtDur(l.eet_min)} + táxi estimado)</dd>
        <dt>Matrícula</dt><dd>${l.registration || 'não associada'}</dd>
        <dt>Tipo</dt><dd>${l.type_icao || '—'} · previsto no RPL: ${l.planned_type || '—'}</dd>
        ${l.ref_date ? html`<dt>Referência RPL</dt><dd>${fmtDate(l.ref_date)} (padrão semanal)</dd>` : ''}
        ${l.notes ? html`<dt>Observações</dt><dd>${l.notes}</dd>` : ''}
      </dl>
      ${(l.checks || []).length ? html`<div class="strip-checks">${l.checks.map((c) => html`<div class="${c.level}">${icon(CHECK_ICO[c.level])}${c.message}</div>`)}</div>` : ''}
      ${extra}
    </div>`,
  });
}

// ------------------------------------------------------------------ calendário
export function calendarHTML({ mode, anchor, legs, reserves = [] }) {
  const today = isoDate(new Date());
  const byDay = new Map();
  legs.forEach((l) => { if (!byDay.has(l.local_date)) byDay.set(l.local_date, []); byDay.get(l.local_date).push(l); });
  const a = parseISODate(anchor);
  if (mode === 'month') {
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), ds = isoDate(d);
      if (i >= 35 && d.getMonth() !== a.getMonth()) break;
      const ls = (byDay.get(ds) || []).sort((x, y) => x.dep_utc.localeCompare(y.dep_utc));
      const r = reserveOf(reserves, ds);
      const label = r && (ds === r.start_date || i % 7 === 0);
      cells.push(html`<div class="cal-day ${d.getMonth() !== a.getMonth() ? 'out' : ''} ${ds === today ? 'today' : ''} ${r ? 'in-res' : ''}">
        <span class="dn">${d.getDate()}</span>
        ${r ? html`<div class="cal-res ${ds === r.start_date ? 's' : ''} ${ds === r.end_date ? 'e' : ''}" title="RESERVA ${dm(r.start_date)} a ${dm(r.end_date)} (${r.days} dias) · ${r.location_label} · acionamento ${r.status_label}">${label ? html`RESERVA ${r.location_iata}${ds === r.start_date ? ` · ${r.days}d · ${r.status_label}` : ''}` : html`&nbsp;`}</div>` : ''}
        ${ls.slice(0, 4).map((l) => html`<button class="cal-ev ${l.activity === 'RESERVA' ? 'act' : ''}" data-origin="${l.data_origin}" data-leg="${l.id}" title="${l.flight_number || 'POS'} ${l.adep}-${l.ades} ${l.registration || ''}${l.activity === 'RESERVA' ? ' · acionamento de reserva (simulado)' : ''}"><b>${legTime(l, 'dep').t}</b> ${l.flight_number || 'POS'} <span class="rt">${l.adep}-${l.ades}</span></button>`)}
        ${ls.length > 4 ? html`<button class="cal-more" data-day="${ds}">+${ls.length - 4} perna(s)</button>` : ''}
      </div>`);
    }
    return html`<div class="cal-month">${WEEK_SHORT.map((w) => html`<div class="wd">${w}</div>`)}${cells}</div>`;
  }
  const start = addDays(a, -((a.getDay() + 6) % 7));
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), ds = isoDate(d);
    const ls = byDay.get(ds) || [];
    const r = reserveOf(reserves, ds);
    cols.push(html`<div class="col ${r ? 'in-res' : ''}" ${r ? html`title="RESERVA ${dm(r.start_date)} a ${dm(r.end_date)} · ${r.location_label} · acionamento ${r.status_label}"` : ''}>${ls.map((l) => {
      const t = legTime(l, 'dep').t.split(':').map(Number);
      const top = (t[0] * 60 + t[1]) / 60 * 40;
      const h = Math.max(22, l.block_min / 60 * 40);
      return html`<button class="blk ${l.activity === 'RESERVA' ? 'act' : ''}" data-origin="${l.data_origin}" data-leg="${l.id}" style="top:${top}px;height:${Math.min(h, 960 - top)}px" title="${l.flight_number || 'POS'} ${l.adep}-${l.ades}"><b>${legTime(l, 'dep').t} ${l.flight_number || 'POS'}</b><br>${l.adep}→${l.ades}${l.registration ? ` · ${l.registration}` : ''}</button>`;
    })}</div>`);
  }
  const heads = [...Array(7)].map((_, i) => { const d = addDays(start, i); const r = reserveOf(reserves, isoDate(d)); return html`<div class="wh ${isoDate(d) === today ? 'today' : ''} ${r ? 'in-res' : ''}">${WEEK_SHORT[i]} ${d.getDate()}/${d.getMonth() + 1}${r ? html` <span class="res-tag sm" title="${r.location_label} · acionamento ${r.status_label}">RESERVA ${r.location_iata}</span>` : ''}</div>`; });
  return html`<div class="cal-week" data-autoscroll="200"><div class="wh"></div>${heads}<div class="hours">${[...Array(24)].map((_, h) => html`<div>${String(h).padStart(2, '0')}h</div>`)}</div>${cols}</div>`;
}

export function calendarTitle(mode, anchor) {
  const a = parseISODate(anchor);
  if (mode === 'month') { const n = MONTHS_FULL[a.getMonth()]; return `${n[0].toUpperCase()}${n.slice(1)} ${a.getFullYear()}`; }
  const s = addDays(a, -((a.getDay() + 6) % 7)), e = addDays(s, 6);
  return `${s.getDate()}/${s.getMonth() + 1} a ${e.getDate()}/${e.getMonth() + 1}/${e.getFullYear()}`;
}

export function calendarRange(mode, anchor) {
  const a = parseISODate(anchor);
  if (mode === 'month') {
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return [isoDate(start), isoDate(addDays(start, 41))];
  }
  const s = addDays(a, -((a.getDay() + 6) % 7));
  return [isoDate(s), isoDate(addDays(s, 6))];
}

export function shiftAnchor(mode, anchor, dir) {
  const a = parseISODate(anchor);
  if (mode === 'month') return isoDate(new Date(a.getFullYear(), a.getMonth() + dir, 1));
  return isoDate(addDays(a, 7 * dir));
}

// Liga a interação padrão do calendário a um contêiner
export function bindCalendar(container, getLegs, rerender) {
  container.addEventListener('click', (e) => {
    const ev = e.target.closest('[data-leg]');
    if (ev && (ev.classList.contains('cal-ev') || ev.classList.contains('blk'))) {
      const l = getLegs().find((x) => String(x.id) === ev.dataset.leg);
      if (l) showLegModal(l);
    }
    const more = e.target.closest('[data-day]');
    if (more && more.classList.contains('cal-more')) {
      const ls = getLegs().filter((l) => l.local_date === more.dataset.day);
      openModal({ title: fmtDate(more.dataset.day, { weekday: true }), wide: true, body: html`<div class="stack">${ls.map((l) => stripHTML(l, { actions: false, showChecks: false }))}</div>` });
    }
  });
  return rerender;
}

export { mount };
