import { api, html, mount, icon, state, $, toastError, airlineTag, fmtDate, fmtDur, qs, WEEK_LETTERS } from '../core.js';

export async function render(el) {
  const p = qs();
  const f = { airline: p.get('airline') || '', q: p.get('q') || '', adep: p.get('adep') || '', ades: p.get('ades') || '', type: '', date: '', status: p.get('status') || '', import_id: p.get('import_id') || '', offset: 0 };
  const apmap = Object.fromEntries(state.meta.airports.map((a) => [a.icao, a]));

  mount(el, html`
    <div class="page-head"><div><h1>Voos do RPL</h1><p class="lead">Registros importados, exatamente como estão nos arquivos. Horários em UTC (EOBT) com conversão para o horário local do aeroporto.</p></div></div>
    ${f.import_id ? html`<div class="notice" style="margin-bottom:12px">${icon('info')}<div>Mostrando somente a importação #${f.import_id}. <a href="#/voos">Ver todos os RPL ativos</a></div></div>` : ''}
    <form class="row" id="flt" style="margin-bottom:14px">
      <select class="input sm" name="airline" style="width:auto"><option value="">Todas as cias</option>${state.meta.airlines.map((a) => html`<option ${f.airline === a.code ? 'selected' : ''}>${a.code}</option>`)}</select>
      <input class="input sm" name="q" placeholder="Voo ou rota (ex.: GLO1000, UZ25)" value="${f.q}" style="width:220px">
      <input class="input sm" name="adep" placeholder="Origem" value="${f.adep}" maxlength="4" style="width:90px;text-transform:uppercase" list="ap-list2">
      <input class="input sm" name="ades" placeholder="Destino" value="${f.ades}" maxlength="4" style="width:90px;text-transform:uppercase" list="ap-list2">
      <input class="input sm" name="type" placeholder="Tipo" maxlength="4" style="width:80px;text-transform:uppercase">
      <label class="small text-2 row" style="gap:6px">Opera em <input class="input sm" type="date" name="date" style="width:auto"></label>
      <select class="input sm" name="status" style="width:auto"><option value="">Qualquer status</option><option value="ok" ${f.status === 'ok' ? 'selected' : ''}>OK</option><option value="warning" ${f.status === 'warning' ? 'selected' : ''}>Com aviso</option><option value="error" ${f.status === 'error' ? 'selected' : ''}>Com erro</option></select>
      <button class="btn sm primary" type="submit">${icon('search')}Filtrar</button>
    </form>
    <datalist id="ap-list2">${state.meta.airports.map((a) => html`<option value="${a.icao}">${a.city || ''}</option>`)}</datalist>
    <div id="res"></div>`);

  function localOf(icao, dateStr, hhmmStr) {
    const ap = apmap[icao];
    if (!ap?.tz || !hhmmStr) return '';
    try {
      const d = new Date(`${dateStr || '2026-10-22'}T${hhmmStr.slice(0, 2)}:${hhmmStr.slice(2)}:00Z`);
      return d.toLocaleTimeString('pt-BR', { timeZone: ap.tz, hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  async function load() {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v !== null));
    q.set('limit', 100);
    let r;
    try { r = await api('/rpl/flights?' + q); } catch (e) { toastError(e); return; }
    mount($('#res', el), r.items.length ? html`
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Voo</th><th>Tipo</th><th>Origem</th><th>EOBT</th><th>Destino</th><th>EET</th><th>Dias</th><th>Validade</th><th>FL</th><th>Status</th></tr></thead><tbody>
      ${r.items.map((x) => html`<tr class="clickable" data-id="${x.id}">
        <td class="strong">${airlineTag(x.airline)} ${x.flight_number}</td><td>${x.type_icao}/${x.wake}</td>
        <td>${x.adep} <span class="muted small">${apmap[x.adep]?.city || 'não cadastrado'}</span></td>
        <td>${x.eobt.slice(0, 2)}:${x.eobt.slice(2)}Z <span class="muted small">${localOf(x.adep, f.date || x.valid_from, x.eobt)}</span></td>
        <td>${x.ades} <span class="muted small">${apmap[x.ades]?.city || 'não cadastrado'}</span></td>
        <td>${fmtDur(x.eet_min)}</td>
        <td><span class="days-mask">${[...x.days].map((c, i) => html`<i class="${c !== '0' ? 'on' : ''}">${WEEK_LETTERS[i]}</i>`)}</span></td>
        <td class="small">${fmtDate(x.valid_from, { year: false })}–${fmtDate(x.valid_to, { year: false })}</td><td>${x.fl}</td>
        <td>${x.status === 'ok' ? html`<span class="badge ok">OK</span>` : x.status === 'warning' ? html`<span class="badge warn" title="${x.issues.map((i) => i.message).join('\n')}">aviso</span>` : html`<span class="badge err" title="${x.issues.map((i) => i.message).join('\n')}">erro</span>`}</td></tr>
        <tr hidden data-detail="${x.id}"><td colspan="10"><div class="grid grid-2">
          <div class="stack"><dl class="kv" style="grid-template-columns:110px 1fr"><dt>Rota</dt><dd>${x.route || '—'}</dd><dt>Velocidade</dt><dd>${x.speed}</dd><dt>Arquivo</dt><dd>${x.filename} · linha ${x.line_no}</dd>
            ${Object.entries(x.remarks_json).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
            ${x.issues.length ? html`<div class="strip-checks">${x.issues.map((i) => html`<div class="${i.severity}">${icon('alert')}${i.message}</div>`)}</div>` : ''}</div>
          <div><div class="small muted" style="margin-bottom:6px">Texto original</div><div class="raw">${x.raw_text}</div></div></div></td></tr>`)}
      </tbody></table></div>
      <div class="pager"><span>${r.offset + 1}–${r.offset + r.items.length} de ${r.total.toLocaleString('pt-BR')}</span>
        <button class="btn sm" data-pg="-1" ${r.offset === 0 ? 'disabled' : ''}>Anterior</button><button class="btn sm" data-pg="1" ${r.offset + r.items.length >= r.total ? 'disabled' : ''}>Próxima</button></div>`
      : html`<div class="empty"><h3>Nenhum registro encontrado</h3><p>${state.meta.airlines.some((a) => a.coverage) ? 'Ajuste os filtros.' : html`Importe arquivos em <a href="#/importacoes">Importar RPL</a>.`}</p></div>`);
  }

  $('#flt', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    for (const k of ['airline', 'q', 'adep', 'ades', 'type', 'date', 'status']) f[k] = (fd.get(k) || '').trim();
    f.offset = 0; load();
  });
  el.onclick = (e) => {
    const pg = e.target.closest('[data-pg]'); if (pg) { f.offset = Math.max(0, f.offset + 100 * +pg.dataset.pg); load(); return; }
    const tr = e.target.closest('tr[data-id]'); if (tr) { const d = el.querySelector(`[data-detail="${tr.dataset.id}"]`); d.hidden = !d.hidden; tr.classList.toggle('expanded', !d.hidden); }
  };
  await load();
  return () => { el.onclick = null; };
}
