import { api, html, mount, icon, state, $, $$, toastError, toast, withBusy, airlineTag, fmtDate, fmtDur, openModal,
  confirmDialog, download, legend, originBadge, ORIGIN, esc, refreshMeta } from '../core.js';
import { timelineHTML, cardsHTML, calendarHTML, calendarTitle, shiftAnchor, bindCalendar, showLegModal, reserveHeadHTML } from '../legs.js';

export async function render(el, parts) {
  if (parts[0]) return renderDetail(el, +parts[0]);
  return renderList(el);
}

async function renderList(el) {
  const { items } = await api('/schedules');
  mount(el, html`
    <div class="page-head">
      <div><h1>Escalas</h1><p class="lead">Escalas salvas. Cada uma pertence a uma matrícula (ou a um tipo, quando gerada sem matrícula).</p></div>
      <div class="actions"><a class="btn primary" href="#/gerador">${icon('wand')}Gerar escala</a></div>
    </div>
    ${items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>Nome</th><th>Cia</th><th>Matrícula</th><th>Tipo</th><th>Período</th><th class="num">Pernas</th><th>Composição</th><th>Google</th><th>Atualizada</th><th></th></tr></thead><tbody>
      ${items.map((s) => html`<tr class="clickable" data-id="${s.id}">
        <td class="strong">${s.name}</td><td>${airlineTag(s.airline)}</td><td>${s.registration || html`<span class="muted">—</span>`}</td>
        <td>${s.kind}</td><td>${fmtDate(s.start_date, { year: false })} a ${fmtDate(s.end_date)}</td><td class="num">${s.legs}</td>
        <td><div class="row" style="gap:6px">${s.real_legs ? html`<span class="badge real">${s.real_legs} reais</span>` : ''}${s.proj_legs ? html`<span class="badge proj">${s.proj_legs} proj.</span>` : ''}${s.other_legs ? html`<span class="badge sugg">${s.other_legs} outras</span>` : ''}</div></td>
        <td>${s.gcal_events ? html`<span class="badge ok">${s.gcal_events} eventos</span>` : html`<span class="muted small">—</span>`}</td>
        <td class="small muted">${s.updated_at.slice(0, 16).replace('T', ' ')}Z</td>
        <td><button class="icon-btn danger" data-del="${s.id}" title="Excluir escala">${icon('trash')}</button></td></tr>`)}
    </tbody></table></div>` : html`<div class="empty"><h3>Nenhuma escala ainda</h3><p>Escolha companhia, período e aeronave para gerar a primeira.</p><a class="btn primary" href="#/gerador">${icon('wand')}Gerar escala</a></div>`}`);
  el.onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!await confirmDialog('Excluir esta escala e todas as pernas? Eventos já enviados ao Google Calendar não são apagados automaticamente (use "Remover do Google" antes, se quiser).', { ok: 'Excluir', danger: true })) return;
      try { await api(`/schedules/${del.dataset.del}`, { method: 'DELETE' }); toast('Escala excluída.'); renderList(el); } catch (er) { toastError(er); }
      return;
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/escalas/${tr.dataset.id}`;
  };
  return () => { el.onclick = null; };
}

async function renderDetail(el, sid) {
  let s = await api(`/schedules/${sid}`);
  let tab = sessionStorage.getItem('as.tab') || 'timeline';
  let calMode = 'month';
  let anchor = s.start_date;

  const draw = () => {
    const sm = s.summary;
    const diagErr = s.diagnostics.filter((d) => d.level === 'error');
    const diagWarn = s.diagnostics.filter((d) => d.level === 'warning');
    mount(el, html`
      <div class="page-head">
        <div>
          <div class="row muted small" style="margin-bottom:6px"><a href="#/escalas">Escalas</a><span>/</span>${airlineTag(s.airline)}<span class="badge">${s.kind}</span></div>
          <h1 id="sched-name" title="Clique para renomear" style="cursor:text">${s.name}</h1>
          <p class="lead">${fmtDate(s.start_date, { weekday: true })} a ${fmtDate(s.end_date, { weekday: true })} · ${s.aircraft ? html`<b>${s.aircraft.registration}</b> (${s.aircraft.icao_type || 'sem modelo'})${s.aircraft.is_demo ? html` <span class="badge demo">FICTÍCIA</span>` : ''}` : html`sem matrícula (${s.params.icao_type_resolved || 'tipo'})`} · base ${s.params.base_resolved || '—'}</p>
        </div>
        <div class="actions">
          <a class="btn" href="#/briefing/escala/${sid}">${icon('clipboard')}Briefing do dia</a>
          <button class="btn" data-a="export-txt">${icon('file')}Texto</button>
          <button class="btn" data-a="export-csv">${icon('download')}CSV</button>
          <button class="btn" data-a="export-ics">${icon('calendar')}.ics</button>
          <button class="btn" data-a="google">${icon('sync')}Google Calendar</button>
          <button class="btn" data-a="regen-all">${icon('refresh')}Regerar tudo</button>
          <button class="btn ghost" data-a="more">${icon('edit')}Mais</button>
        </div>
      </div>
      <div class="stat-line" style="margin-bottom:18px;grid-template-columns:repeat(5,minmax(0,1fr))">
        <div><div class="v">${sm.legs}</div><div class="l">pernas em ${sm.days} dia(s)</div></div>
        <div><div class="v">${fmtDur(sm.block_min)}</div><div class="l">tempo de bloco estimado</div></div>
        <div><div class="v"><span style="color:var(--real)">${sm.by_origin.REAL}</span> / <span style="color:var(--proj)">${sm.by_origin.PROJETADO}</span> / <span style="color:var(--sugg)">${sm.by_origin.SUGESTAO + sm.by_origin.MANUAL}</span></div><div class="l">reais / projetadas / sugestões e manuais</div></div>
        <div><div class="v" style="color:${sm.errors ? 'var(--err)' : sm.warnings ? 'var(--warn)' : 'var(--ok)'}">${sm.errors ? `${sm.errors} erro(s)` : sm.warnings ? `${sm.warnings} aviso(s)` : 'Coerente'}</div><div class="l">validação de continuidade</div></div>
        ${(() => { const c = s.crew.summary; const off = c.mode === 'off'; return html`<div><div class="v" style="color:${off ? 'var(--muted)' : c.errors ? 'var(--err)' : c.warnings ? 'var(--warn)' : 'var(--ok)'}">${off ? 'Desligadas' : c.errors ? `${c.errors} violação(ões)` : c.warnings ? `${c.warnings} aviso(s)` : 'Dentro das regras'}</div><div class="l"><a href="#" data-tab="crew">regras de tripulação</a></div></div>`; })()}
      </div>
      <div class="notice orange" style="margin-bottom:12px">${icon('info')}<div>O RPL não informa matrículas nem o rodízio real das aeronaves. Os voos <b>reais</b> existem nos arquivos; a <b>sequência</b> e a <b>matrícula</b> são sugestões do AeroScale, validadas por continuidade e tempo de solo.${s.rotation ? html` Modelo de rodízio: base provável <b>${s.rotation.base || '—'}</b> (confiança ${s.rotation.base_confidence}), ${s.rotation.turnbacks} bate-volta(s) (${s.rotation.paired_turnbacks} com número consecutivo), pernoites em ${s.rotation.overnights.join(', ') || '—'}.` : ''}</div></div>
      ${(s.reserves || []).map((r) => html`<section class="panel res-panel" style="margin-bottom:12px">${reserveHeadHTML(r, { buttons: true })}
        <p class="text-2 small" style="margin-top:8px">Sorteios salvos: local ${Math.round(r.location_roll)} vs ${Math.round(r.base_pct)}% para a base · acionamento ${Math.round(r.activation_roll)} vs ${Math.round(r.activation_pct)}%. ${r.note}</p></section>`)}
      ${!(s.reserves || []).length && s.kind !== 'avulsa' ? html`<div class="notice" style="margin-bottom:12px">${icon('info')}<div>Esta escala não tem bloco de reserva${s.params.reserve_blocks === 0 ? ' (desligado na geração)' : s.params.reserve_blocks === undefined ? ' (criada antes da reserva automática)' : ''}. <button class="btn sm" type="button" data-a="res-add" style="margin-left:6px">${icon('plus')}Sortear reserva</button></div></div>` : ''}
      ${s.summary.anomalies ? html`<div class="notice warn" style="margin-bottom:12px">${icon('alert')}<div><b>${s.summary.anomalies} anormalidade(s)</b>: vai-e-volta repetido no mesmo par de aeroportos no mesmo dia. As pernas estão marcadas com o selo "Anormalidade". A chance fica em Configurações → Geral.</div></div>` : ''}
      ${diagErr.length || diagWarn.length ? html`<details class="panel" style="margin-bottom:18px;padding:14px 18px" ${diagErr.length ? 'open' : ''}><summary style="cursor:pointer">${diagErr.length ? html`<span class="badge err">${diagErr.length} erro(s)</span> ` : ''}${diagWarn.length ? html`<span class="badge warn">${diagWarn.length} aviso(s)</span> ` : ''} Diagnóstico da geração</summary>
        <div class="strip-checks" style="margin-top:10px">${s.diagnostics.map((d) => html`<div class="${d.level}">${icon(d.level === 'info' ? 'info' : 'alert')}${d.message}</div>`)}</div></details>` : ''}
      <div class="tabs" role="tablist">
        <button data-tab="timeline" class="${tab === 'timeline' ? 'on' : ''}">${icon('strips')}Linha do tempo</button>
        <button data-tab="calendar" class="${tab === 'calendar' ? 'on' : ''}">${icon('calendar')}Calendário</button>
        <button data-tab="cards" class="${tab === 'cards' ? 'on' : ''}">${icon('cards')}Cartões</button>
        <button data-tab="crew" class="${tab === 'crew' ? 'on' : ''}">${icon('clock')}Jornadas e folgas</button>
        <span class="spacer"></span>
        <button data-a="add">${icon('plus')}Adicionar perna</button>
        <button data-a="sort">${icon('sort')}Ordenar por horário</button>
      </div>
      <div style="margin-bottom:14px">${legend()}</div>
      <div id="tab-body">${tabBody()}</div>`);
  };

  const tabBody = () => {
    if (tab === 'cards') return cardsHTML(s.legs);
    if (tab === 'crew') return crewHTML(s);
    if (tab === 'calendar') return html`<div class="cal-toolbar">
        <button class="icon-btn" data-cal="-1" aria-label="Anterior">${icon('left')}</button><button class="icon-btn" data-cal="1" aria-label="Próximo">${icon('right')}</button>
        <span class="title">${calendarTitle(calMode, anchor)}</span>
        <div class="seg"><button data-calmode="month" class="${calMode === 'month' ? 'on' : ''}">Mês</button><button data-calmode="week" class="${calMode === 'week' ? 'on' : ''}">Semana</button></div>
      </div><div id="cal">${calendarHTML({ mode: calMode, anchor, legs: s.legs, reserves: s.reserves })}</div>`;
    return timelineHTML(s.legs, { duties: s.crew.duties, continuation: s.continuation, reserves: s.reserves });
  };

  const reload = async (data) => { s = data || await api(`/schedules/${sid}`); draw(); };
  const legById = (id) => s.legs.find((l) => String(l.id) === String(id));

  async function call(btn, fn, okMsg) {
    try { await withBusy(btn, async () => { const r = await fn(); await reload(r && r.legs ? r : (r && r.schedule) || null); }); if (okMsg) toast(okMsg); } catch (e) { toastError(e); }
  }

  function pickAlternative(leg, mode) {
    const title = mode === 'replace' ? `Substituir ${leg.flight_number || 'perna'}` : mode === 'after' ? `Inserir depois de ${leg.flight_number || 'perna'}` : 'Adicionar voo do RPL';
    const m = openModal({ title, wide: true, body: html`<div class="skeleton"></div>` });
    const url = leg ? `/legs/${leg.id}/alternatives?mode=${mode}` : `/schedules/${sid}/alternatives`;
    api(url).then((r) => {
      const body = $('.modal-body', m.el);
      mount(body, html`<p class="text-2" style="margin-bottom:12px">Voos do RPL partindo de <b>${r.from_airport || '—'}</b> entre ${r.window[0].slice(5, 16).replace('T', ' ')}Z e ${r.window[1].slice(5, 16).replace('T', ' ')}Z${r.next_airport ? html`. Para manter a continuidade, o destino ideal é <b>${r.next_airport}</b>.` : '.'}</p>
        ${r.candidates.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Voo</th><th>Trecho</th><th>Partida</th><th>Chegada</th><th>Tipo</th><th>Dado</th><th>Encaixe</th><th></th></tr></thead><tbody>
        ${r.candidates.map((c) => html`<tr class="${c.type_ok ? '' : 'inactive'}"><td class="strong">${c.ident}</td><td>${c.adep} → ${c.ades}</td><td>${c.dep_local}</td><td>${c.arr_local}</td>
          <td>${c.type_icao}${c.type_ok ? '' : html` <span class="badge err">incompatível</span>`}</td><td>${originBadge(c.origin)}</td>
          <td>${r.next_airport ? (c.fits_next ? html`<span class="badge ok">mantém continuidade</span>` : html`<span class="badge warn">quebra com a próxima</span>`) : html`<span class="muted small">—</span>`}</td>
          <td><button class="btn sm ${c.fits_next || !r.next_airport ? 'primary' : ''}" data-ref="${c.ref}">Usar</button></td></tr>`)}
        </tbody></table></div>` : html`<div class="empty"><h3>Nenhum voo encontrado</h3><p>Não há voos do RPL partindo de ${r.from_airport || '—'} nessa janela.</p></div>`}`);
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-ref]'); if (!b) return;
        const payload = { ref: b.dataset.ref };
        if (mode === 'replace') payload.replace_leg_id = leg.id;
        if (mode === 'after') payload.after_leg_id = leg.id;
        await call(b, () => api(`/schedules/${sid}/legs`, { method: 'POST', body: payload }), 'Perna atualizada.');
        m.close();
      });
    }).catch((e) => { toastError(e); m.close(); });
  }

  function editLeg(leg) {
    const m = openModal({
      title: `Editar ${leg.flight_number || 'perna'}`, drawer: true,
      body: html`<form id="leg-form" class="stack">
        <div class="notice">${icon('info')}<div>Alterar voo, trecho ou horários transforma a perna em <b>manual</b>. Ela será comparada com o RPL e sinalizada se não existir.</div></div>
        <div class="form-grid">
          <label class="field">Voo<input class="input" name="flight_number" value="${leg.flight_number || ''}"></label>
          <label class="field">Origem (ICAO)<input class="input" name="adep" value="${leg.adep}" maxlength="4"></label>
          <label class="field">Destino (ICAO)<input class="input" name="ades" value="${leg.ades}" maxlength="4"></label>
          <label class="field wide">Partida (UTC)<input class="input" type="datetime-local" name="dep_utc" value="${leg.dep_utc.slice(0, 16)}"></label>
          <label class="field wide">Chegada (UTC)<input class="input" type="datetime-local" name="arr_utc" value="${leg.arr_utc.slice(0, 16)}"></label>
          <label class="field full">Matrícula desta perna<select class="input" name="aircraft_id"></select></label>
          <label class="field full">Observações<textarea class="input" name="notes">${leg.notes || ''}</textarea></label>
        </div>
        <div class="row"><button type="button" class="btn sm" data-mv="-1">${icon('up')}Mover para cima</button><button type="button" class="btn sm" data-mv="1">${icon('down')}Mover para baixo</button><span class="spacer"></span><button type="button" class="btn sm danger" data-delleg>${icon('trash')}Excluir perna</button></div>
      </form>`,
      foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Salvar</button>`,
    });
    api(`/aircraft?airline=${s.airline}&status=all`).then(({ items }) => {
      mount($('[name=aircraft_id]', m.el), html`<option value="">Sem matrícula</option>${items.map((a) => html`<option value="${a.id}" ${a.id === leg.aircraft_id ? 'selected' : ''}>${a.registration} · ${a.icao_type || 'sem modelo'}${a.active ? '' : ' (desativada)'}</option>`)}`);
    });
    m.el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-save]')) {
        const f = $('#leg-form', m.el);
        const body = { notes: f.notes.value, aircraft_id: f.aircraft_id.value ? +f.aircraft_id.value : null };
        if (f.flight_number.value !== (leg.flight_number || '')) body.flight_number = f.flight_number.value;
        if (f.adep.value.toUpperCase() !== leg.adep) body.adep = f.adep.value;
        if (f.ades.value.toUpperCase() !== leg.ades) body.ades = f.ades.value;
        if (f.dep_utc.value !== leg.dep_utc.slice(0, 16)) body.dep_utc = f.dep_utc.value + ':00Z';
        if (f.arr_utc.value !== leg.arr_utc.slice(0, 16)) body.arr_utc = f.arr_utc.value + ':00Z';
        if ((body.aircraft_id || null) === (leg.aircraft_id || null)) delete body.aircraft_id;
        await call(e.target.closest('[data-save]'), () => api(`/legs/${leg.id}`, { method: 'PUT', body }), 'Perna salva.');
        m.close();
      }
      const mv = e.target.closest('[data-mv]');
      if (mv) { await call(mv, () => api(`/legs/${leg.id}/move`, { method: 'POST', body: { direction: +mv.dataset.mv } })); m.close(); }
      if (e.target.closest('[data-delleg]')) {
        if (!await confirmDialog(`Excluir a perna ${leg.flight_number || ''} ${leg.adep}→${leg.ades}?`, { ok: 'Excluir', danger: true })) return;
        await call(null, () => api(`/legs/${leg.id}`, { method: 'DELETE' }), 'Perna excluída.');
        m.close();
      }
    });
  }

  function addLeg() {
    const last = s.legs[s.legs.length - 1];
    const m = openModal({
      title: 'Adicionar perna',
      body: html`<div class="stack">
        <div class="row"><button class="btn primary" data-from-rpl>${icon('route')}Escolher voo real do RPL${last ? ` após ${last.flight_number || 'última perna'}` : ''}</button></div>
        <hr><h3>Ou digitar uma perna manual</h3>
        <form id="man-form" class="form-grid">
          <label class="field">Voo<input class="input" name="flight_number" placeholder="${s.airline}1234"></label>
          <label class="field">Origem<input class="input" name="adep" maxlength="4" value="${last ? last.ades : ''}"></label>
          <label class="field">Destino<input class="input" name="ades" maxlength="4"></label>
          <label class="field wide">Partida (UTC)<input class="input" type="datetime-local" name="dep_utc" required></label>
          <label class="field wide">Chegada (UTC)<input class="input" type="datetime-local" name="arr_utc" required></label>
          <label class="field full">Observações<input class="input" name="notes"></label>
        </form></div>`,
      foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn" data-add-manual>Adicionar manual</button>`,
    });
    m.el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-from-rpl]')) { m.close(); pickAlternative(last || null, last ? 'after' : 'start'); }
      if (e.target.closest('[data-add-manual]')) {
        const f = $('#man-form', m.el);
        if (!f.dep_utc.value || !f.arr_utc.value) { toast('Informe partida e chegada.', 'warn'); return; }
        await call(e.target.closest('[data-add-manual]'), () => api(`/schedules/${sid}/legs`, { method: 'POST', body: {
          flight_number: f.flight_number.value, adep: f.adep.value, ades: f.ades.value, dep_utc: f.dep_utc.value + ':00Z', arr_utc: f.arr_utc.value + ':00Z', notes: f.notes.value } }), 'Perna manual adicionada.');
        m.close();
      }
    });
  }

  async function googleModal() {
    const g = state.meta.google;
    if (!g.configured || !g.connected) {
      openModal({ title: 'Google Calendar', body: html`<div class="stack"><p class="text-2">${g.configured ? 'A credencial OAuth já foi enviada, falta autorizar sua conta Google.' : 'Configure a credencial OAuth do Google e conecte sua conta para enviar as pernas como eventos.'}</p><p class="text-2">Enquanto isso, você pode exportar o arquivo <b>.ics</b> e importar manualmente no Google Calendar.</p></div>`,
        foot: html`<button class="btn" data-close>Fechar</button><a class="btn primary" href="#/configuracoes?tab=google" data-close>Configurar Google Calendar</a>` });
      return;
    }
    const m = openModal({ title: 'Enviar para o Google Calendar', body: html`<div class="skeleton" style="height:40px"></div>`, foot: html`<button class="btn ghost" data-close>Fechar</button><button class="btn primary" data-sync disabled>${icon('sync')}Sincronizar</button>` });
    try {
      const { items, selected } = await api('/google/calendars');
      mount($('.modal-body', m.el), html`<div class="stack">
        <label class="field">Agenda de destino<select class="input" id="g-cal">${items.map((c) => html`<option value="${c.id}" ${c.id === selected || (!selected && c.primary) ? 'selected' : ''}>${c.summary}${c.primary ? ' (principal)' : ''}</option>`)}</select></label>
        <label class="check"><input type="checkbox" id="g-del" checked> Remover do Google os eventos de pernas que foram excluídas desta escala</label>
        <p class="hint">Cada perna vira um evento com companhia, voo, matrícula, origem, destino e horários (fuso de cada aeroporto). Reenviar atualiza os eventos existentes, sem duplicar.</p>
        <div id="g-res"></div></div>`);
      const btn = $('[data-sync]', m.el); btn.disabled = false;
      btn.addEventListener('click', () => withBusy(btn, async () => {
        try {
          const r = await api(`/schedules/${sid}/google-sync`, { method: 'POST', body: { calendar_id: $('#g-cal', m.el).value, remove_deleted: $('#g-del', m.el).checked } });
          mount($('#g-res', m.el), html`<div class="notice ${r.errors.length ? 'warn' : ''}">${icon(r.errors.length ? 'alert' : 'check')}<div><b>Sincronizado.</b> ${r.created} criado(s), ${r.updated} atualizado(s), ${r.unchanged} sem alteração, ${r.deleted} removido(s)${r.duplicates_removed ? `, ${r.duplicates_removed} duplicata(s) removida(s)` : ''}.
            ${r.errors.length ? html`<div class="strip-checks" style="margin-top:6px">${r.errors.slice(0, 10).map((x) => html`<div class="error">${x}</div>`)}</div>` : ''}</div></div>`);
          s.gcal_events = r.created + r.updated + r.unchanged;
          refreshMeta();
        } catch (e) { toastError(e); }
      }));
    } catch (e) { toastError(e); m.close(); }
  }

  function moreMenu() {
    const m = openModal({
      title: 'Mais ações', body: html`<div class="stack">
        <label class="field">Nome<input class="input" id="mm-name" value="${s.name}"></label>
        <label class="field">Matrícula da escala inteira<select class="input" id="mm-ac"></select><span class="hint">Troca a matrícula de todas as pernas. A validação aponta incompatibilidades de tipo e conflitos.</span></label>
        <label class="field">Notas<textarea class="input" id="mm-notes">${s.notes || ''}</textarea></label>
        <details><summary class="muted" style="cursor:pointer">Parâmetros usados na geração</summary><pre class="raw" style="margin-top:8px">${JSON.stringify(s.params, null, 2)}</pre></details>
        <hr>
        <div class="row"><button class="btn danger" data-gremove>${icon('calendar')}Remover eventos do Google</button><button class="btn danger" data-delsched>${icon('trash')}Excluir escala</button></div>
      </div>`,
      foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Salvar</button>`,
    });
    api(`/aircraft?airline=${s.airline}&status=active`).then(({ items }) => {
      mount($('#mm-ac', m.el), html`<option value="">Sem matrícula</option>${items.map((a) => html`<option value="${a.id}" ${s.aircraft && a.id === s.aircraft.id ? 'selected' : ''}>${a.registration} · ${a.icao_type || 'sem modelo'}</option>`)}`);
    });
    m.el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-save]')) {
        const acv = $('#mm-ac', m.el).value;
        const body = { name: $('#mm-name', m.el).value, notes: $('#mm-notes', m.el).value };
        if ((acv || '') !== String(s.aircraft?.id || '')) body.aircraft_id = acv ? +acv : null;
        await call(e.target.closest('[data-save]'), () => api(`/schedules/${sid}`, { method: 'PUT', body }), 'Escala salva.');
        m.close();
      }
      if (e.target.closest('[data-delsched]')) {
        if (!await confirmDialog('Excluir a escala inteira?', { ok: 'Excluir', danger: true })) return;
        try { await api(`/schedules/${sid}`, { method: 'DELETE' }); m.close(); toast('Escala excluída.'); location.hash = '#/escalas'; } catch (er) { toastError(er); }
      }
      if (e.target.closest('[data-gremove]')) {
        if (!await confirmDialog('Apagar do Google Calendar todos os eventos desta escala (agenda selecionada em Configurações)?', { ok: 'Remover', danger: true })) return;
        try { const r = await api(`/schedules/${sid}/google-remove`, { method: 'POST', body: {} }); toast(`${r.deleted} evento(s) removido(s) do Google.`); } catch (er) { toastError(er); }
      }
    });
  }

  async function textModal() {
    let r;
    try { r = await api(`/schedules/${sid}/text`); } catch (er) { toastError(er); return; }
    const m = openModal({
      title: 'Escala em texto',
      body: html`<p class="hint" style="margin-bottom:8px">Um dia por linha: aeroportos (IATA) e, entre parênteses, os números de voo. Dia sem voo = FOLGA.</p>
        <textarea class="input mono" id="txt-out" rows="18" readonly style="width:100%;resize:vertical">${r.text}</textarea>`,
      foot: html`<button class="btn" data-x="dl">${icon('download')}Baixar .txt</button><button class="btn primary" data-x="copy">${icon('check')}Copiar</button>`,
    });
    m.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'dl') download(`/api/schedules/${sid}/export.txt`);
      if (b.dataset.x === 'copy') {
        try { await navigator.clipboard.writeText(r.text); toast('Escala copiada.'); }
        catch { const ta = m.el.querySelector('#txt-out'); ta.select(); document.execCommand('copy'); toast('Escala copiada.'); }
      }
    });
  }

  el.onclick = async (e) => {
    const t = e.target;
    const tb = t.closest('[data-tab]');
    if (tb) { e.preventDefault(); tab = tb.dataset.tab; sessionStorage.setItem('as.tab', tab); draw(); return; }
    const a = t.closest('[data-a]');
    if (a) {
      const act = a.dataset.a;
      if (act === 'export-txt') textModal();
      if (act === 'res-redraw' || act === 'res-add') {
        const msg = act === 'res-add' ? 'Sortear um bloco de reserva para esta escala? Os voos serão replanejados em volta dela.'
          : 'Fazer um novo sorteio da reserva (datas, local e acionamento)? Os voos fora da reserva são replanejados; edições manuais serão perdidas.';
        if (!await confirmDialog(msg, { ok: 'Sortear' })) return;
        call(a, () => api(`/schedules/${sid}/reserve/redraw`, { method: 'POST', body: act === 'res-add' ? { blocks: 1 } : {} }), 'Reserva sorteada de novo.');
      }
      if (act === 'export-csv') download(`/api/schedules/${sid}/export.csv`);
      if (act === 'export-ics') download(`/api/schedules/${sid}/export.ics`);
      if (act === 'google') googleModal();
      if (act === 'more') moreMenu();
      if (act === 'add') addLeg();
      if (act === 'sort') call(a, () => api(`/schedules/${sid}/sort`, { method: 'POST' }), 'Pernas ordenadas por horário.');
      if (act === 'regen-all') {
        if (!await confirmDialog('Regerar a escala inteira com os mesmos critérios? Edições manuais serão perdidas.', { ok: 'Regerar' })) return;
        call(a, () => api(`/schedules/${sid}/regenerate`, { method: 'POST', body: {} }), 'Escala regerada.');
      }
      return;
    }
    const rd = t.closest('[data-regen-day]');
    if (rd) {
      if (!await confirmDialog(`Regerar as pernas de ${fmtDate(rd.dataset.regenDay, { weekday: true })}? O sistema tenta manter a continuidade com o dia anterior e o seguinte.`, { ok: 'Regerar dia' })) return;
      call(rd, () => api(`/schedules/${sid}/regenerate`, { method: 'POST', body: { day: rd.dataset.regenDay } }), 'Dia regerado.');
      return;
    }
    const cal = t.closest('[data-cal]');
    if (cal) { anchor = shiftAnchor(calMode, anchor, +cal.dataset.cal); $('#tab-body', el).innerHTML = String(tabBody()); return; }
    const cm = t.closest('[data-calmode]');
    if (cm) { calMode = cm.dataset.calmode; $('#tab-body', el).innerHTML = String(tabBody()); return; }
    const act = t.closest('[data-act]');
    if (act) {
      const leg = legById(act.closest('[data-leg]').dataset.leg);
      if (act.dataset.act === 'replace') pickAlternative(leg, 'replace');
      if (act.dataset.act === 'after') pickAlternative(leg, 'after');
      if (act.dataset.act === 'more') editLeg(leg);
      if (act.dataset.act === 'regen') {
        if (!await confirmDialog(`Apagar esta perna e todas as seguintes e gerar de novo a partir de ${leg.adep}?`, { ok: 'Regerar daqui' })) return;
        call(act, () => api(`/schedules/${sid}/regenerate`, { method: 'POST', body: { from_leg_id: leg.id } }), 'Escala regerada a partir da perna.');
      }
      return;
    }
    const h = t.closest('#sched-name');
    if (h) {
      const v = prompt('Novo nome da escala:', s.name);
      if (v && v.trim() && v !== s.name) call(null, () => api(`/schedules/${sid}`, { method: 'PUT', body: { name: v } }), 'Nome atualizado.');
      return;
    }
    const pass = t.closest('.pass[data-leg], .cal-ev[data-leg], .blk[data-leg]');
    if (pass) { const l = legById(pass.dataset.leg); if (l) showLegModal(l); }
    const more = t.closest('.cal-more');
    if (more) {
      const ls = s.legs.filter((l) => l.local_date === more.dataset.day);
      openModal({ title: fmtDate(more.dataset.day, { weekday: true }), wide: true, body: timelineHTML(ls, { actions: false, dayActions: false }) });
    }
  };
  draw();
  return () => { el.onclick = null; };
}

const WDN = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
function crewHTML(s) {
  const c = s.crew, sm = c.summary, p = s.params;
  const wm = p.weekday_max || {};
  const lvl = (d) => (d.issues.some((i) => i.level === 'error') ? 'err' : d.issues.length ? 'warn' : '');
  return html`<div class="stack" style="gap:18px">
    <div class="grid grid-3">
      <div class="panel"><h3 style="margin-bottom:8px">Perfil</h3><p class="text-2">${sm.mode_label}</p>
        <p class="hint" style="margin-top:6px">Solo mínimo: ${sm.min_turn ?? '—'} min ${sm.min_turn_source ? `(${sm.min_turn_source})` : ''}</p>
        <div class="row" style="margin-top:10px;gap:4px">${WDN.map((n, i) => html`<span class="badge ${wm[String(i)] === 0 ? 'orange' : ''}" title="${wm[String(i)] === 0 ? 'folga fixa' : wm[String(i)] ? `até ${wm[String(i)]} perna(s)` : 'padrão'}">${n} ${wm[String(i)] === 0 ? 'folga' : wm[String(i)] ?? '·'}</span>`)}</div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Totais</h3><dl class="kv" style="grid-template-columns:150px 1fr">
        <dt>Jornadas</dt><dd>${sm.duties} · ${sm.duty_h} h</dd><dt>Horas de voo (bloco)</dt><dd>${sm.block_h} h</dd>
        <dt>Madrugadas</dt><dd>${sm.madrugadas}</dd><dt>Máx. dias seguidos</dt><dd>${sm.max_consecutive}</dd>
        ${sm.reserve_days ? html`<dt>Dias de reserva</dt><dd>${sm.reserve_days} (contam como trabalho)</dd>` : ''}</dl></div>
      <div class="panel"><h3 style="margin-bottom:8px">Por mês</h3>${Object.entries(sm.months).map(([mk, m]) => html`<dl class="kv" style="grid-template-columns:150px 1fr;margin-bottom:6px">
        <dt>${mk}</dt><dd>${m.days} dia(s) na escala</dd><dt>Folgas</dt><dd>${m.off} (mínimo ${m.required_off})${m.weekend_pair ? ' · com sábado+domingo' : ''}</dd>
        <dt>Voo / jornada</dt><dd>${m.block_h} h / ${m.duty_h} h</dd></dl>`)}</div>
    </div>
    ${c.violations.length ? html`<div class="strip-checks">${c.violations.map((v) => html`<div class="${v.level}">${icon('alert')}${v.message}</div>`)}</div>` : ''}
    ${c.duties.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Data</th><th>Apresentação</th><th>Fim</th><th>Trecho</th><th class="num">Pousos</th><th>Jornada / limite</th><th>Voo / limite</th><th>Repouso antes</th><th>Observações</th></tr></thead><tbody>
      ${c.duties.map((d) => html`<tr><td>${d.index}</td><td>${d.date.slice(8, 10)}/${d.date.slice(5, 7)} ${WDN[(new Date(d.date + 'T12:00').getDay() + 6) % 7]}</td>
        <td>${d.report_local}</td><td>${d.release_local}</td><td>${d.start} → ${d.end}</td><td class="num">${d.legs}${d.max_legs ? `/${d.max_legs}` : ''}</td>
        <td title="${d.limit_source}"><div class="row" style="gap:8px;flex-wrap:nowrap"><span>${fmtDur(Math.round(d.duty_h * 60))} / ${d.fdp_limit_h}h</span><span class="duty-bar ${lvl(d)}"><i style="width:${Math.min(100, d.duty_h / d.fdp_limit_h * 100)}%"></i></span></div></td>
        <td>${fmtDur(Math.round(d.block_h * 60))} / ${d.flight_limit_h}h</td>
        <td>${d.rest_before_h === null ? '—' : html`${fmtDur(Math.round(d.rest_before_h * 60))}${d.rest_required_h ? html` <span class="muted small">(mín. ${d.rest_required_h}h)</span>` : ''}`}</td>
        <td>${d.madrugada ? html`<span class="badge">madrugada</span> ` : ''}${d.issues.map((i) => html`<div class="small" style="color:${i.level === 'error' ? 'var(--err)' : 'var(--warn)'}">${i.message}</div>`)}</td></tr>`)}
    </tbody></table></div>` : html`<div class="empty"><h3>Nenhuma jornada</h3></div>`}
    <p class="hint">Jornada = 30 min antes da 1ª partida até 30 min após a última chegada. Fontes: Lei 13.475/2017 (arts. 31, 33, 35, 41, 42, 48, 50, 51) e RBAC 117, Apêndice B, Tabela B.1.</p>
  </div>`;
}
