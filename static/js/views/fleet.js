import { api, html, mount, icon, state, $, $$, toastError, toast, withBusy, airlineTag, openModal, confirmDialog,
  download, triPill, refreshMeta, qs, esc } from '../core.js';

const TARGET_LABELS = {
  ignore: 'Ignorar', registration: 'Matrícula', model: 'Modelo (texto livre)', icao_type: 'Tipo ICAO', msn: 'MSN / nº de série',
  notes: 'Observações', airline: 'Companhia', equipment_list: 'Lista de equipamentos presentes', new_field: 'Criar novo campo SIM/NÃO',
};
const SEV = { error: 'err', warning: 'warn', info: '' };

export async function render(el) {
  const p = qs();
  let tab = p.get('tab') || 'aeronaves';
  const f = { airline: p.get('airline') || '', model_id: '', q: '', status: 'active', review: '', no_model: p.get('sem_modelo') ? '1' : '', eq: [] };
  const sel = new Set();
  let items = [];

  const fieldsFor = (airline, family) => state.meta.fields.filter((x) => x.active && (!x.airline || x.airline === airline) && (!family || !x.family || x.family === family));

  async function draw() {
    mount(el, html`
      <div class="page-head">
        <div><h1>Frota</h1><p class="lead">Matrículas, modelos e configurações individuais por aeronave. Nenhuma configuração é presumida pelo modelo: o que não foi informado fica como desconhecido.</p></div>
        <div class="actions"><button class="btn" data-a="export">${icon('download')}Exportar CSV</button><button class="btn primary" data-a="new">${icon('plus')}Nova aeronave</button></div>
      </div>
      <div class="tabs">
        ${[['aeronaves', 'Aeronaves', 'tail'], ['importar', 'Importar lista', 'upload'], ['revisao', `Revisão${state.meta.open_flags ? ` (${state.meta.open_flags})` : ''}`, 'flag'], ['modelos', 'Modelos', 'plane'], ['campos', 'Campos de configuração', 'list'], ['historico', 'Importações de frota', 'clock']]
          .map(([id, l, ic]) => html`<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${icon(ic)}${l}</button>`)}
      </div>
      <div id="tab"></div>`);
    if (tab === 'aeronaves') await drawAircraft();
    if (tab === 'modelos') await drawModels();
    if (tab === 'campos') drawFields();
    if (tab === 'importar') drawImport();
    if (tab === 'revisao') await drawReview();
    if (tab === 'historico') await drawFleetImports();
  }

  // ---------------------------------------------------------------- aeronaves
  async function loadAircraft() {
    const q = new URLSearchParams({ status: f.status });
    if (f.airline) q.set('airline', f.airline);
    if (f.model_id) q.set('model_id', f.model_id);
    if (f.q) q.set('q', f.q);
    if (f.review) q.set('review', '1');
    if (f.no_model) q.set('no_model', '1');
    if (f.eq.length) q.set('eq', f.eq.join(','));
    items = (await api('/aircraft?' + q)).items;
  }

  async function drawAircraft() {
    await loadAircraft();
    const box = $('#tab', el);
    const models = state.meta.models.filter((m) => !f.airline || m.airline === f.airline);
    const cols = f.airline ? fieldsFor(f.airline) : state.meta.fields.filter((x) => x.active && !x.airline);
    const triFields = (f.airline ? fieldsFor(f.airline) : state.meta.fields.filter((x) => x.active)).filter((x) => x.kind === 'tri');
    mount(box, html`
      <div class="row" style="margin-bottom:14px">
        <select class="input sm" id="ff-airline" style="width:auto"><option value="">Todas as cias</option>${state.meta.airlines.map((a) => html`<option value="${a.code}" ${f.airline === a.code ? 'selected' : ''}>${a.code} – ${a.name}</option>`)}</select>
        <select class="input sm" id="ff-model" style="width:auto"><option value="">Todos os modelos</option>${models.map((m) => html`<option value="${m.id}" ${String(f.model_id) === String(m.id) ? 'selected' : ''}>${m.airline} · ${m.name} (${m.icao_type})</option>`)}</select>
        <input class="input sm" id="ff-q" placeholder="Matrícula, MSN ou nota" value="${f.q}" style="width:200px">
        <select class="input sm" id="ff-status" style="width:auto"><option value="active">Ativas</option><option value="inactive">Desativadas</option><option value="all">Todas</option></select>
        <label class="check small"><input type="checkbox" id="ff-review" ${f.review ? 'checked' : ''}> Com pendências</label>
        <label class="check small"><input type="checkbox" id="ff-nomodel" ${f.no_model ? 'checked' : ''}> Sem modelo</label>
        <span class="spacer"></span>
        <select class="input sm" id="ff-eqfield" style="width:auto"><option value="">+ Filtro de equipamento</option>${triFields.map((x) => html`<option value="${x.id}">${x.label}${x.airline ? ` (${x.airline}${x.family ? '/' + x.family : ''})` : ''}</option>`)}</select>
      </div>
      ${f.eq.length ? html`<div class="row" style="margin:-4px 0 12px">${f.eq.map((e, i) => { const [fid, v] = e.split(':'); const fl = state.meta.fields.find((x) => String(x.id) === fid); return html`<span class="chip">${fl?.label || fid} = ${v}<button data-rmeq="${i}" aria-label="Remover filtro">×</button></span>`; })}</div>` : ''}
      ${!f.airline ? html`<p class="hint" style="margin-bottom:10px">Selecione uma companhia para ver as colunas de configuração específicas dela.</p>` : ''}
      ${(() => { const nm = items.filter((a) => !a.model_id && a.active).length; return nm && !f.no_model ? html`<div class="notice warn" style="margin-bottom:12px">${icon('alert')}<div style="flex:1">${nm} aeronave(s) sem modelo associado: elas não entram no gerador de escalas.</div><button class="btn sm" data-a="sel-nomodel">Selecionar e associar modelo</button></div>` : ''; })()}
      ${sel.size ? html`<div class="notice orange" style="margin-bottom:12px;align-items:center">${icon('check')}<div style="flex:1"><b>${sel.size}</b> aeronave(s) selecionada(s)</div><button class="btn sm primary" data-a="bulk">${icon('edit')}Alterar em lote</button><button class="btn sm ghost" data-a="sel-clear">Limpar seleção</button></div>` : ''}
      ${items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:34px"><input type="checkbox" id="ff-all" aria-label="Selecionar todas" ${items.length && items.every((a) => sel.has(a.id)) ? 'checked' : ''}></th><th>Matrícula</th><th>Cia</th><th>Modelo</th>${cols.map((c) => html`<th title="${c.description || ''}">${c.label}${c.family ? html` <span class="src">${c.family}</span>` : ''}</th>`)}<th>Restrições</th><th>Pendências</th><th>Origem</th></tr></thead><tbody>
        ${items.map((a) => html`<tr class="clickable ${a.active ? '' : 'inactive'}" data-id="${a.id}">
          <td><input type="checkbox" data-sel="${a.id}" ${sel.has(a.id) ? 'checked' : ''} aria-label="Selecionar ${a.registration}"></td>
          <td class="strong">${a.registration} ${a.is_demo ? html`<span class="badge demo" title="Dados fictícios de demonstração">FICTÍCIA</span>` : ''}${a.active ? '' : html` <span class="badge">desativada</span>`}</td>
          <td>${airlineTag(a.airline)}</td>
          <td>${a.model_name ? html`${a.model_name} <span class="muted small">${a.icao_type}</span>` : html`<span class="badge warn">sem modelo</span>`}</td>
          ${cols.map((c) => { const v = a.config[String(c.id)]; const applies = !c.family || !a.family || c.family === a.family; return html`<td>${!applies ? html`<span class="muted small">n/a</span>` : c.kind === 'tri' ? triPill(v?.value) : html`<span class="small">${v?.value || '—'}</span>`}</td>`; })}
          <td class="small text-2">${[a.blocked_airports ? `restritos: ${a.blocked_airports}` : '', a.unavailable.length ? `${a.unavailable.length} indisponib.` : ''].filter(Boolean).join(' · ') || '—'}</td>
          <td>${a.open_flags ? html`<span class="badge warn">${a.open_flags}</span>` : html`<span class="muted small">—</span>`}</td>
          <td class="small muted">${{ import: 'lista', manual: 'manual', demo: 'demo', adsb: 'ADS-B' }[a.source] || a.source}</td></tr>`)}
      </tbody></table></div><p class="hint" style="margin-top:8px">${items.length} aeronave(s). ${icon('info')} <span class="tri sim">SIM</span> · <span class="tri nao">NÃO</span> · <span class="tri desc">?</span> desconhecido.</p>`
      : html`<div class="empty"><h3>Nenhuma aeronave ${f.airline || f.q || f.eq.length ? 'com esses filtros' : 'cadastrada'}</h3>
        <p>Importe a lista TXT de matrículas, cadastre manualmente ou carregue as aeronaves fictícias de demonstração.</p>
        <div class="row"><button class="btn primary" data-tab="importar">${icon('upload')}Importar lista</button><button class="btn" data-a="new">${icon('plus')}Nova aeronave</button><button class="btn" data-a="demo">Carregar dados fictícios</button></div></div>`}`);
    $('#ff-status', box).value = f.status;
    const openId = qs().get('open');
    if (openId) { history.replaceState(null, '', '#/frota'); openAircraft(+openId); }
  }

  async function openAircraft(id, isNew = false) {
    let a = isNew ? null : await api(`/aircraft/${id}`);
    const airlines = state.meta.airlines;
    const draft = { airline: a?.airline || f.airline || airlines[0].code, config: {} };
    const body = () => {
      const fam = a?.family || state.meta.models.find((m) => String(m.id) === String(draft.model_id ?? a?.model_id))?.family;
      const fields = fieldsFor(a?.airline || draft.airline, fam);
      const models = state.meta.models.filter((m) => m.airline === (a?.airline || draft.airline));
      return html`<form id="ac-form" class="stack" autocomplete="off">
        ${a?.is_demo ? html`<div class="notice warn">${icon('alert')}<div><b>Aeronave fictícia</b> criada para demonstração. A matrícula não existe.</div></div>` : ''}
        <div class="form-grid">
          <label class="field">Matrícula<input class="input" name="registration" value="${a?.registration || ''}" required placeholder="PR-XXX" style="text-transform:uppercase"></label>
          <label class="field">Companhia<select class="input" name="airline" ${a ? 'disabled' : ''}>${airlines.map((x) => html`<option value="${x.code}" ${(a?.airline || draft.airline) === x.code ? 'selected' : ''}>${x.code}</option>`)}</select></label>
          <label class="field wide">Modelo<select class="input" name="model_id"><option value="">— não associado —</option>${models.map((m) => html`<option value="${m.id}" ${String(m.id) === String(draft.model_id ?? a?.model_id ?? '') ? 'selected' : ''}>${m.name} (${m.icao_type})</option>`)}</select>
            ${a?.model_source === 'import' ? html`<span class="hint">associado pela lista importada</span>` : a?.model_source === 'adsb' ? html`<span class="hint">tipo visto no ADS-B (adsb.lol)</span>` : ''}</label>
          <label class="field">MSN<input class="input" name="msn" value="${a?.msn || ''}"></label>
          <label class="field wide">Aeroportos restritos<input class="input" name="blocked_airports" value="${a?.blocked_airports || ''}" placeholder="ex.: SBRJ, SBJV" style="text-transform:uppercase"><span class="hint">O gerador nunca usa esses aeroportos com esta matrícula.</span></label>
          <label class="field full">Observações<textarea class="input" name="notes">${a?.notes || ''}</textarea></label>
        </div>
        <div><h3 style="margin-bottom:6px">Indisponibilidade</h3><div id="unav"></div><button type="button" class="btn sm" data-addu>${icon('plus')}Adicionar período</button></div>
        <div><h3 style="margin-bottom:4px">Configuração</h3>
          ${fields.length ? fields.map((fl) => { const cur = a?.config?.[String(fl.id)]; const v = draft.config[fl.id] ?? cur?.value ?? (fl.kind === 'tri' ? 'DESCONHECIDO' : '');
            return html`<div class="cfg-row"><div class="lbl"><span>${fl.label}</span><span class="src">${fl.description || ''}${cur ? ` · ${cur.source === 'import' ? 'da lista' : cur.source === 'manual' ? 'editado manualmente' : cur.source}${cur.raw && cur.raw !== cur.value ? ` (original: "${cur.raw}")` : ''}` : ' · sem informação'}</span></div>
            ${fl.kind === 'tri' ? html`<div class="tri-edit" data-f="${fl.id}">${['SIM', 'NÃO', 'DESCONHECIDO'].map((o) => html`<button type="button" data-v="${o}" class="${v === o ? 'on' : ''}">${o === 'DESCONHECIDO' ? '?' : o}</button>`)}</div>`
              : fl.kind === 'select' ? html`<select class="input sm" data-fs="${fl.id}" style="width:180px"><option value=""></option>${fl.options.map((o) => html`<option ${v === o ? 'selected' : ''}>${o}</option>`)}</select>`
              : html`<input class="input sm" data-fs="${fl.id}" value="${v}" style="width:180px" ${fl.kind === 'number' ? 'inputmode="decimal"' : ''}>`}</div>`; })
            : html`<p class="hint">Nenhum campo de configuração para esta companhia/família. Crie em "Campos de configuração".</p>`}
        </div>
        ${a ? html`
          ${a.flags.length ? html`<div><h3 style="margin-bottom:6px">Pendências</h3><div class="stack" style="gap:6px">${a.flags.map((fl) => html`<div class="notice ${fl.resolved ? '' : SEV[fl.severity] || ''}" style="padding:9px 12px">${icon(fl.resolved ? 'check' : 'alert')}<div style="flex:1">${fl.message}${fl.resolved ? html`<br><small class="muted">Resolvido: ${fl.resolution}</small>` : ''}</div>
            ${fl.resolved ? '' : html`<div class="row" style="flex-wrap:nowrap">${['conflito_config', 'conflito_modelo'].includes(fl.code) ? html`<button type="button" class="btn sm" data-flag="${fl.id}" data-act="accept_import">Usar valor da lista</button><button type="button" class="btn sm" data-flag="${fl.id}" data-act="keep_current">Manter atual</button>` : html`<button type="button" class="btn sm" data-flag="${fl.id}" data-act="ack">Revisado</button>`}</div>`}</div>`)}</div></div>` : ''}
          ${a.raw_records.length ? html`<details><summary class="muted" style="cursor:pointer">Registros originais das listas (${a.raw_records.length})</summary><div class="raw" style="margin-top:8px">${a.raw_records.map((r) => `#${r.import_id} linha ${r.line_no}: ${r.raw_text}`).join('\n')}</div></details>` : ''}
          <details id="hist"><summary class="muted" style="cursor:pointer">Histórico de alterações</summary><div class="timeline-h" id="hist-body" style="margin-top:8px"></div></details>` : ''}
      </form>`;
    };
    const m = openModal({
      title: a ? a.registration : 'Nova aeronave', drawer: true, body: body(),
      foot: html`${a ? html`<button class="btn ${a.active ? 'danger' : ''}" data-toggle>${icon('power')}${a.active ? 'Desativar' : 'Reativar'}</button>` : ''}<span class="spacer"></span><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>${a ? 'Salvar alterações' : 'Cadastrar'}</button>`,
    });
    let unav = [...(a?.unavailable || [])];
    const drawUnav = () => mount($('#unav', m.el), unav.length ? unav.map((u, i) => html`<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><input class="input sm" type="date" data-u="${i}" data-k="from" value="${u.from}"><span class="muted">a</span><input class="input sm" type="date" data-u="${i}" data-k="to" value="${u.to}"><input class="input sm" placeholder="Motivo" data-u="${i}" data-k="reason" value="${u.reason || ''}"><button type="button" class="icon-btn danger" data-rmu="${i}" aria-label="Remover">${icon('x')}</button></div>`) : html`<p class="hint" style="margin-bottom:6px">Sem períodos cadastrados.</p>`);
    const rebind = () => { mount($('.modal-body', m.el), body()); drawUnav(); };
    drawUnav();
    m.el.addEventListener('input', (e) => { const i = e.target.dataset.u; if (i !== undefined) unav[+i][e.target.dataset.k] = e.target.value; const fs = e.target.dataset.fs; if (fs) draft.config[fs] = e.target.value; });
    m.el.addEventListener('change', (e) => {
      if (e.target.name === 'airline') { draft.airline = e.target.value; draft.model_id = ''; rebind(); }
      if (e.target.name === 'model_id') { draft.model_id = e.target.value; const keep = $('#ac-form', m.el); const snap = { registration: keep.registration.value, msn: keep.msn.value, notes: keep.notes.value, blocked_airports: keep.blocked_airports.value }; rebind(); Object.entries(snap).forEach(([k, v]) => { $('#ac-form', m.el)[k].value = v; }); }
      const fs = e.target.dataset.fs; if (fs) draft.config[fs] = e.target.value;
    });
    m.el.addEventListener('toggle', async (e) => {
      if (e.target.id === 'hist' && e.target.open) {
        const { items: h } = await api(`/aircraft/${a.id}/history`);
        mount($('#hist-body', m.el), h.length ? h.map((x) => html`<div><span class="ts">${x.ts.slice(0, 16).replace('T', ' ')}Z<br>${x.source || ''}</span><span>${x.action}${x.field ? html` · <b>${x.field}</b>: ${x.old_value ?? '∅'} → ${x.new_value ?? '∅'}` : ''}${x.note ? html`<br><small class="muted">${x.note}</small>` : ''}</span></div>`) : html`<p class="muted">Sem histórico.</p>`);
      }
    }, true);
    m.el.addEventListener('click', async (e) => {
      const tb = e.target.closest('.tri-edit button');
      if (tb) { const fid = tb.parentElement.dataset.f; draft.config[fid] = tb.dataset.v; $$('button', tb.parentElement).forEach((x) => x.classList.toggle('on', x === tb)); return; }
      if (e.target.closest('[data-addu]')) { unav.push({ from: '', to: '', reason: '' }); drawUnav(); return; }
      const rmu = e.target.closest('[data-rmu]'); if (rmu) { unav.splice(+rmu.dataset.rmu, 1); drawUnav(); return; }
      const fb = e.target.closest('[data-flag]');
      if (fb) {
        try { await api(`/review/${fb.dataset.flag}/resolve`, { method: 'POST', body: { action: fb.dataset.act } }); a = await api(`/aircraft/${a.id}`); rebind(); refreshMeta(); toast('Pendência resolvida.'); } catch (er) { toastError(er); }
        return;
      }
      if (e.target.closest('[data-toggle]')) {
        try { a = await api(`/aircraft/${a.id}/active`, { method: 'POST', body: { active: !a.active } }); toast(a.active ? 'Aeronave reativada.' : 'Aeronave desativada.'); m.close(); drawAircraft(); } catch (er) { toastError(er); }
        return;
      }
      const sv = e.target.closest('[data-save]');
      if (sv) {
        const fm = $('#ac-form', m.el);
        const payload = { registration: fm.registration.value, model_id: fm.model_id.value ? +fm.model_id.value : null, msn: fm.msn.value,
          notes: fm.notes.value, blocked_airports: fm.blocked_airports.value, unavailable: unav.filter((u) => u.from || u.to), config: draft.config };
        if (!a) payload.airline = fm.airline.value;
        await withBusy(sv, async () => {
          try {
            a = a ? await api(`/aircraft/${a.id}`, { method: 'PUT', body: payload }) : await api('/aircraft', { method: 'POST', body: payload });
            toast(`${a.registration} salva.`); m.close(); await refreshMeta(); drawAircraft();
          } catch (er) { toastError(er); }
        });
      }
    });
  }

  // ---------------------------------------------------------------- modelos
  async function drawModels() {
    const models = (await api('/models')).items;
    mount($('#tab', el), html`<div class="grid grid-dash">
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Cia</th><th>Modelo</th><th>Tipo ICAO</th><th>Família</th><th class="num">Aeronaves</th><th>Origem</th><th></th></tr></thead><tbody>
        ${models.map((mo) => html`<tr><td>${airlineTag(mo.airline)}</td><td class="strong">${mo.name}</td><td>${mo.icao_type}</td><td>${mo.family || '—'}</td><td class="num">${mo.aircraft_count}</td><td class="small muted">${mo.source}</td>
          <td class="row" style="flex-wrap:nowrap"><button class="icon-btn" data-edm="${mo.id}" title="Editar">${icon('edit')}</button><button class="icon-btn danger" data-delm="${mo.id}" title="Excluir">${icon('trash')}</button></td></tr>`)}
      </tbody></table></div>
      <form class="panel" id="model-form"><h3 style="margin-bottom:12px" id="mf-title">Novo modelo</h3><input type="hidden" name="id">
        <div class="stack">
          <label class="field">Companhia<select class="input" name="airline">${state.meta.airlines.map((a) => html`<option value="${a.code}">${a.code} – ${a.name}</option>`)}</select></label>
          <label class="field">Nome<input class="input" name="name" placeholder="ex.: A320-214 Sharklets" required></label>
          <label class="field">Tipo ICAO<input class="input" name="icao_type" placeholder="A320" maxlength="4" style="text-transform:uppercase" required></label>
          <label class="field">Família<input class="input" name="family" placeholder="automática pelo tipo" style="text-transform:uppercase"><span class="hint">Usada para escopo de campos e compatibilidade "mesma família".</span></label>
          <div class="row"><button class="btn primary" type="submit">Salvar modelo</button><button class="btn ghost" type="reset">Limpar</button></div>
        </div></form></div>`);
    const fm = $('#model-form', el);
    fm.addEventListener('reset', () => { fm.id.value = ''; $('#mf-title', el).textContent = 'Novo modelo'; });
    fm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { airline: fm.airline.value, name: fm.name.value, icao_type: fm.icao_type.value, family: fm.family.value };
      try { await api(fm.id.value ? `/models/${fm.id.value}` : '/models', { method: fm.id.value ? 'PUT' : 'POST', body }); toast('Modelo salvo.'); await refreshMeta(); drawModels(); } catch (er) { toastError(er); }
    });
    $('#tab', el).onclick = async (e) => {
      const ed = e.target.closest('[data-edm]');
      if (ed) { const mo = models.find((x) => String(x.id) === ed.dataset.edm); fm.id.value = mo.id; fm.airline.value = mo.airline; fm.name.value = mo.name; fm.icao_type.value = mo.icao_type; fm.family.value = mo.family || ''; $('#mf-title', el).textContent = `Editar ${mo.name}`; }
      const dl = e.target.closest('[data-delm]');
      if (dl && await confirmDialog('Excluir este modelo?', { ok: 'Excluir', danger: true })) { try { await api(`/models/${dl.dataset.delm}`, { method: 'DELETE' }); toast('Modelo excluído.'); await refreshMeta(); drawModels(); } catch (er) { toastError(er); } }
    };
  }

  // ---------------------------------------------------------------- campos
  function drawFields() {
    const fields = state.meta.fields;
    mount($('#tab', el), html`<div class="grid grid-dash">
      <div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Campo</th><th>Chave</th><th>Tipo</th><th>Companhia</th><th>Família</th><th>Ordem</th><th>Ativo</th><th></th></tr></thead><tbody>
        ${fields.map((x) => html`<tr class="${x.active ? '' : 'inactive'}" data-fid="${x.id}"><td><input class="input sm" data-k="label" value="${x.label}"></td><td class="small muted">${x.key}</td>
          <td>${{ tri: 'SIM/NÃO/?', text: 'texto', number: 'número', select: 'lista' }[x.kind]}</td>
          <td><select class="input sm" data-k="airline"><option value="">Todas</option>${state.meta.airlines.map((a) => html`<option ${x.airline === a.code ? 'selected' : ''}>${a.code}</option>`)}</select></td>
          <td><input class="input sm" data-k="family" value="${x.family || ''}" placeholder="todas" style="width:90px;text-transform:uppercase"></td>
          <td><input class="input sm" data-k="sort" type="number" value="${x.sort}" style="width:70px"></td>
          <td><input type="checkbox" data-k="active" ${x.active ? 'checked' : ''}></td>
          <td><button class="btn sm" data-savef="${x.id}">Salvar</button></td></tr>`)}
        </tbody></table></div>
        <p class="hint" style="margin-top:8px">Campos desativados somem dos formulários, mas os valores já gravados são preservados.</p>
      </div>
      <form class="panel" id="field-form"><h3 style="margin-bottom:12px">Novo campo</h3><div class="stack">
        <label class="field">Nome<input class="input" name="label" required placeholder="ex.: WIFI, HUD, ACARS"></label>
        <label class="field">Tipo<select class="input" name="kind"><option value="tri">SIM / NÃO / DESCONHECIDO</option><option value="text">Texto</option><option value="number">Número</option><option value="select">Lista de opções</option></select></label>
        <label class="field" id="opt-wrap" hidden>Opções (separadas por vírgula)<input class="input" name="options"></label>
        <label class="field">Companhia<select class="input" name="airline"><option value="">Todas</option>${state.meta.airlines.map((a) => html`<option>${a.code}</option>`)}</select></label>
        <label class="field">Família<select class="input" name="family"><option value="">Todas</option>${state.meta.families.map((x) => html`<option>${x}</option>`)}</select></label>
        <label class="field">Descrição<input class="input" name="description"></label>
        <button class="btn primary" type="submit">${icon('plus')}Criar campo</button></div></form></div>`);
    const fm = $('#field-form', el);
    fm.kind.addEventListener('change', () => { $('#opt-wrap', el).hidden = fm.kind.value !== 'select'; });
    fm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/config-fields', { method: 'POST', body: Object.fromEntries(new FormData(fm)) }); toast('Campo criado.'); await refreshMeta(); drawFields(); } catch (er) { toastError(er); }
    });
    $('#tab', el).onclick = async (e) => {
      const b = e.target.closest('[data-savef]'); if (!b) return;
      const tr = b.closest('tr');
      const v = (k) => $(`[data-k="${k}"]`, tr);
      try {
        await api(`/config-fields/${b.dataset.savef}`, { method: 'PUT', body: { label: v('label').value, airline: v('airline').value, family: v('family').value.toUpperCase(), sort: v('sort').value, active: v('active').checked } });
        toast('Campo atualizado.'); await refreshMeta(); drawFields();
      } catch (er) { toastError(er); }
    };
  }

  // ---------------------------------------------------------------- importação
  function drawImport() {
    mount($('#tab', el), html`<div class="grid grid-dash"><div class="stack" style="gap:18px">
      <div class="panel"><div class="stack">
        <label class="dropzone" id="fdz">${icon('upload')}<b>Solte aqui a lista de frota (TXT ou CSV)</b><span>Tabelas com tabulação, ponto e vírgula, barra vertical, vírgula ou colunas alinhadas; também listas em blocos "CHAVE: VALOR".</span><input type="file" id="ffile" accept=".txt,.csv,.tsv,.dat" hidden></label>
        <div class="form-grid"><label class="field">Companhia da lista<select class="input" id="fair"><option value="">Detectar automaticamente</option>${state.meta.airlines.map((a) => html`<option value="${a.code}">${a.code} – ${a.name}</option>`)}</select></label></div>
      </div></div>
      <div id="fprev"></div></div>
      <aside class="panel"><h3 style="margin-bottom:10px">Regras da importação</h3><ul class="text-2" style="margin:0;padding-left:18px;display:grid;gap:8px;font-size:13.5px">
        <li>Você confere o mapeamento das colunas antes de gravar.</li>
        <li>Matrículas são únicas: uma matrícula existente é atualizada, nunca duplicada.</li>
        <li>Valores editados manualmente não são sobrescritos; divergências viram pendências em "Revisão".</li>
        <li>Campo vazio ou não reconhecido fica DESCONHECIDO, nunca SIM.</li>
        <li>Valor "desconhecido" na lista nova não apaga um valor já conhecido.</li>
        <li>O texto original de cada linha fica guardado na aeronave.</li>
        <li>Exemplos fictícios em <code>samples/frota/</code>.</li></ul></aside></div>`);
    const dz = $('#fdz', el), inp = $('#ffile', el);
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) preview(e.dataTransfer.files[0]); });
    inp.addEventListener('change', () => inp.files[0] && preview(inp.files[0]));
  }

  async function preview(file) {
    const fd = new FormData(); fd.append('file', file); fd.append('airline', $('#fair', el).value);
    let pv;
    try { pv = await api('/fleet/preview', { method: 'POST', form: fd }); } catch (e) { toastError(e); return; }
    pv.airline = pv.airline_guess || '';
    pv.attrs = (pv.list_attributes || []).map((t) => ({ label: t, kind: 'tri', value: 'SIM' }));
    pv.model_id = '';
    const isList = pv.format === 'lista de matrículas';
    const targets = () => {
      const flds = state.meta.fields.filter((x) => x.active && (!x.airline || x.airline === pv.airline));
      return [...Object.entries(TARGET_LABELS), ...flds.map((x) => [`field:${x.id}`, `Campo: ${x.label}${x.airline ? ` (${x.airline}${x.family ? '/' + x.family : ''})` : ''}`])];
    };
    const readMapping = () => { const m = {}; $$('[data-col]', $('#fprev', el)).forEach((s2) => { m[s2.dataset.col] = s2.value; }); return m; };
    const drawPrev = () => {
      const models = state.meta.models.filter((m) => m.airline === pv.airline);
      const hasModelCol = Object.values(pv.mapping).some((v) => v === 'model' || v === 'icao_type');
      mount($('#fprev', el), html`<div class="panel">
      <div class="panel-head"><h2>${pv.filename}</h2><span class="badge">${pv.format}</span><span class="badge">separador: ${pv.delimiter}</span><span class="badge">${pv.row_count} linha(s)</span><span class="badge">${pv.encoding}</span></div>
      ${pv.title ? html`<p class="text-2" style="margin-bottom:10px">Título detectado: “${pv.title}”</p>` : ''}
      ${pv.notes.map((n) => html`<div class="notice warn" style="margin-bottom:8px">${icon('alert')}<div>${n}</div></div>`)}
      <div class="form-grid" style="margin-bottom:14px">
        <label class="field">Companhia<select class="input ${pv.airline ? '' : 'invalid'}" id="fair2"><option value="">Selecione…</option>${state.meta.airlines.map((a) => html`<option value="${a.code}" ${pv.airline === a.code ? 'selected' : ''}>${a.code} – ${a.name}</option>`)}</select>${pv.airline_guess ? html`<span class="hint">detectada pelo arquivo</span>` : html`<span class="hint" style="color:var(--warn)">Não foi possível detectar: escolha.</span>`}</label>
        <label class="field wide">Modelo das aeronaves ${hasModelCol ? 'sem modelo na linha' : 'desta lista'}<select class="input ${!hasModelCol && !pv.model_id ? 'invalid' : ''}" id="fmodel" ${pv.airline ? '' : 'disabled'}><option value="">${pv.airline ? '— não associar agora —' : 'escolha a companhia primeiro'}</option>${models.map((m) => html`<option value="${m.id}" ${String(pv.model_id) === String(m.id) ? 'selected' : ''}>${m.name} (${m.icao_type})</option>`)}</select>
          <span class="hint">${hasModelCol ? 'Usado só nas linhas em que o modelo não foi reconhecido.' : 'Sem modelo, as aeronaves não entram no gerador: o RPL é casado pelo tipo ICAO.'} O modelo nunca é deduzido pela matrícula.</span></label>
      </div>
      <h3 style="margin-bottom:4px">Atributos comuns a todas as linhas</h3>
      <p class="hint" style="margin-bottom:10px">${isList && pv.attrs.length ? 'Sugeridos pelo nome do arquivo. ' : ''}Cada atributo vira um campo gravado em todas as aeronaves da lista. Ex.: “Collins” como campo de texto “Aviônica” = Collins; “ISFD” como campo SIM/NÃO = SIM. Aeronaves fora da lista ficam como desconhecido.</p>
      <div class="stack" style="gap:6px;margin-bottom:8px">${pv.attrs.map((a, i) => html`<div class="row" style="flex-wrap:nowrap">
        <select class="input sm" data-akind="${i}" style="width:190px"><option value="tri" ${a.kind === 'tri' ? 'selected' : ''}>Campo SIM/NÃO = SIM</option><option value="text" ${a.kind === 'text' ? 'selected' : ''}>Campo de texto</option></select>
        <input class="input sm" data-alabel="${i}" value="${a.label}" placeholder="Nome do campo" style="flex:1">
        ${a.kind === 'text' ? html`<span class="muted">=</span><input class="input sm" data-avalue="${i}" value="${a.value === 'SIM' ? '' : a.value}" placeholder="Valor" style="flex:1">` : html`<span class="badge ok">SIM</span>`}
        <button class="icon-btn danger" data-arm="${i}" aria-label="Remover atributo">${icon('x')}</button></div>`)}</div>
      <button class="btn sm" data-aadd>${icon('plus')}Adicionar atributo</button>
      <h3 style="margin:18px 0 8px">Mapeamento das colunas</h3>
      <div class="table-wrap" style="margin-bottom:14px"><table class="tbl"><thead><tr><th>Coluna no arquivo</th><th>Exemplos</th><th>Gravar como</th></tr></thead><tbody>
        ${pv.columns.map((c) => html`<tr><td class="strong">${c}</td><td class="small text-2">${[...new Set(pv.rows.map((r) => r.cells[c]).filter((v) => v))].slice(0, 5).join(' · ') || '(vazio)'}</td>
          <td style="min-width:260px"><select class="input sm" data-col="${c}">${targets().map(([v, l]) => html`<option value="${v}" ${pv.mapping[c] === v ? 'selected' : ''}>${l}</option>`)}</select></td></tr>`)}
      </tbody></table></div>
      <div class="stack" style="margin-bottom:14px">
        ${isList ? '' : html`<label class="check"><input type="checkbox" id="opt-absent"> Ausência de valor/equipamento significa NÃO (use só se a lista for completa)</label>`}
        <label class="check"><input type="checkbox" id="opt-deact"> Desativar aeronaves da companhia que não constam nesta lista</label>
      </div>
      <details><summary class="muted" style="cursor:pointer">Prévia das linhas (${Math.min(pv.rows.length, 300)})</summary>
        <div class="table-wrap" style="margin-top:8px;max-height:320px"><table class="tbl"><thead><tr><th>#</th>${pv.columns.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>
        ${pv.rows.slice(0, 300).map((r) => html`<tr><td class="muted small">${r.line_no}</td>${pv.columns.map((c) => html`<td class="small">${r.cells[c] ?? ''}</td>`)}</tr>`)}</tbody></table></div></details>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="apply-btn">${icon('check')}Importar ${pv.row_count} linha(s)</button><span class="hint">Nada é gravado antes de confirmar. Reimportar a mesma lista atualiza as aeronaves sem duplicar.</span></div>
      <div id="fres" style="margin-top:14px"></div></div>`);
    };
    drawPrev();
    const box = $('#fprev', el);
    box.oninput = (e) => {
      const t = e.target;
      if (t.dataset.alabel !== undefined) pv.attrs[+t.dataset.alabel].label = t.value;
      if (t.dataset.avalue !== undefined) pv.attrs[+t.dataset.avalue].value = t.value;
    };
    box.onchange = async (e) => {
      const t = e.target;
      if (t.id === 'fair2') {
        const keep = readMapping();
        pv.airline = t.value; pv.model_id = '';
        if (t.value) {
          try { pv.mapping = (await api('/fleet/suggest', { method: 'POST', body: { token: pv.token, airline: t.value } })).mapping; } catch (er) { toastError(er); pv.mapping = keep; }
        }
        drawPrev();
      }
      if (t.id === 'fmodel') { pv.model_id = t.value; t.classList.toggle('invalid', !t.value); }
      if (t.dataset.col) pv.mapping[t.dataset.col] = t.value;
      if (t.dataset.akind !== undefined) {
        const a = pv.attrs[+t.dataset.akind];
        if (t.value === 'text' && a.kind === 'tri') { a.value = a.label; a.label = ''; }
        else if (t.value === 'tri' && a.kind === 'text') { a.label = a.value || a.label; a.value = 'SIM'; }
        a.kind = t.value; drawPrev();
      }
    };
    box.onclick = async (e) => {
      const rm = e.target.closest('[data-arm]'); if (rm) { pv.attrs.splice(+rm.dataset.arm, 1); drawPrev(); return; }
      if (e.target.closest('[data-aadd]')) { pv.attrs.push({ label: '', kind: 'tri', value: 'SIM' }); drawPrev(); return; }
      const b = e.target.closest('#apply-btn'); if (!b) return;
      const mapping = readMapping();
      if (!pv.airline) { toast('Escolha a companhia da lista antes de importar.', 'warn'); return; }
      if (!Object.values(mapping).includes('registration')) { toast('Mapeie uma coluna como Matrícula.', 'warn'); return; }
      const bad = pv.attrs.find((a) => !a.label.trim() || (a.kind === 'text' && !String(a.value || '').trim()));
      if (bad) { toast('Preencha nome (e valor, nos campos de texto) de todos os atributos, ou remova os vazios.', 'warn'); return; }
      const hasModelCol = Object.values(mapping).some((v) => v === 'model' || v === 'icao_type');
      if (!hasModelCol && !pv.model_id && !await confirmDialog('Importar sem modelo? As aeronaves ficam fora do gerador até você associar o modelo (Frota → Alterar em lote).', { ok: 'Importar sem modelo' })) return;
      await withBusy(b, async () => {
        try {
          const r = await api('/fleet/apply', { method: 'POST', body: { token: pv.token, mapping, airline: pv.airline, options: {
            absent_means_no: !!$('#opt-absent', box)?.checked, deactivate_missing: $('#opt-deact', box).checked,
            default_model_id: pv.model_id || null, list_attributes: pv.attrs } } });
          mount($('#fres', box), html`<div class="notice ${r.errors || r.conflicts ? 'warn' : ''}">${icon(r.errors || r.conflicts ? 'alert' : 'check')}<div>
            <b>Importação concluída.</b> ${r.created} nova(s), ${r.updated} atualizada(s), ${r.unchanged} sem alteração, ${r.conflicts} conflito(s), ${r.errors} linha(s) com erro, ${r.duplicates_in_file} duplicada(s) no arquivo, ${r.flags} pendência(s) criada(s)${r.missing_from_list ? `, ${r.missing_from_list} aeronave(s) da cia não constam na lista` : ''}.
            ${r.messages.length ? html`<div class="strip-checks" style="margin-top:8px">${r.messages.slice(0, 30).map((x) => html`<div class="warning">Linha ${x.line}: ${x.message}</div>`)}</div>` : ''}
            <div class="row" style="margin-top:10px"><button class="btn sm" data-tab="aeronaves">Ver aeronaves</button>${r.flags ? html`<button class="btn sm" data-tab="revisao">Revisar pendências</button>` : ''}</div></div></div>`);
          b.disabled = true; f.airline = pv.airline;
          await refreshMeta();
        } catch (er) { toastError(er); }
      });
    };
  }

  // ---------------------------------------------------------------- revisão
  async function drawReview(status = 'open') {
    const { items: flags } = await api('/review?status=' + status);
    mount($('#tab', el), html`<div class="row" style="margin-bottom:12px"><div class="seg"><button data-rs="open" class="${status === 'open' ? 'on' : ''}">Abertas</button><button data-rs="resolved" class="${status === 'resolved' ? 'on' : ''}">Resolvidas</button></div><span class="hint">Conflitos entre listas e cadastro manual, modelos não identificados, valores ambíguos e aeroportos sem cadastro.</span></div>
      ${flags.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Gravidade</th><th>Item</th><th>Pendência</th><th>Criada</th><th></th></tr></thead><tbody>
      ${flags.map((x) => html`<tr><td><span class="badge ${SEV[x.severity] || ''}">${{ error: 'erro', warning: 'aviso', info: 'info' }[x.severity]}</span></td>
        <td>${x.entity === 'aircraft' ? html`<a href="#/frota?open=${x.entity_id}">${x.registration || '#' + x.entity_id}</a>` : x.entity === 'airport' ? html`<a href="#/configuracoes?tab=aeroportos&icao=${x.data.icao}">aeroporto ${x.data.icao}</a>` : x.entity}</td>
        <td>${x.message}${x.resolved ? html`<br><small class="muted">${x.resolution}</small>` : ''}</td><td class="small muted">${x.created_at.slice(0, 10)}</td>
        <td>${x.resolved ? '' : html`<div class="row" style="flex-wrap:nowrap">${['conflito_config', 'conflito_modelo'].includes(x.code) ? html`<button class="btn sm" data-flag="${x.id}" data-act="accept_import">Usar lista</button><button class="btn sm" data-flag="${x.id}" data-act="keep_current">Manter atual</button>` : html`<button class="btn sm" data-flag="${x.id}" data-act="ack">Marcar revisado</button>`}</div>`}</td></tr>`)}
      </tbody></table></div>` : html`<div class="empty"><h3>${status === 'open' ? 'Nenhuma pendência aberta' : 'Nenhuma pendência resolvida'}</h3></div>`}`);
    $('#tab', el).onclick = async (e) => {
      const rs = e.target.closest('[data-rs]'); if (rs) { drawReview(rs.dataset.rs); return; }
      const b = e.target.closest('[data-flag]'); if (!b) return;
      try { await api(`/review/${b.dataset.flag}/resolve`, { method: 'POST', body: { action: b.dataset.act } }); toast('Pendência resolvida.'); await refreshMeta(); drawReview(status); } catch (er) { toastError(er); }
    };
  }

  async function drawFleetImports() {
    const { imports } = await api('/fleet/imports');
    mount($('#tab', el), imports.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Data</th><th>Cia</th><th>Arquivo</th><th class="num">Linhas</th><th class="num">Novas</th><th class="num">Atualizadas</th><th class="num">Conflitos</th><th class="num">Erros</th></tr></thead><tbody>
      ${imports.map((i) => html`<tr><td>${i.id}</td><td class="small">${i.imported_at.slice(0, 16).replace('T', ' ')}Z</td><td>${airlineTag(i.airline)}</td><td>${i.filename}</td><td class="num">${i.stats.rows ?? '—'}</td><td class="num">${i.stats.created ?? 0}</td><td class="num">${i.stats.updated ?? 0}</td><td class="num">${i.stats.conflicts ?? 0}</td><td class="num">${i.stats.errors ?? 0}</td></tr>`)}
    </tbody></table></div>` : html`<div class="empty"><h3>Nenhuma lista importada</h3></div>`);
  }

  // ---------------------------------------------------------------- alteração em lote
  function bulkEdit() {
    const chosen = items.filter((x) => sel.has(x.id));
    if (!chosen.length) { toast('Selecione aeronaves na tabela.', 'warn'); return; }
    const airlines = [...new Set(chosen.map((x) => x.airline))];
    const st = { airline: '', model_id: '', field: '', value: '' };
    const body = () => {
      const target = st.airline || (airlines.length === 1 ? airlines[0] : '');
      const models = state.meta.models.filter((m) => m.airline === target);
      const fields = state.meta.fields.filter((x) => x.active && (!x.airline || x.airline === target));
      const fl = fields.find((x) => String(x.id) === String(st.field));
      return html`<div class="stack">
        <p class="text-2">${chosen.length} aeronave(s): ${chosen.slice(0, 12).map((x) => x.registration).join(', ')}${chosen.length > 12 ? '…' : ''}</p>
        <label class="field">Companhia<select class="input" id="bk-air"><option value="">Manter (${airlines.join(', ')})</option>${state.meta.airlines.map((a) => html`<option value="${a.code}" ${st.airline === a.code ? 'selected' : ''}>${a.code} – ${a.name}</option>`)}</select><span class="hint">Use se a lista foi importada na companhia errada.</span></label>
        <label class="field">Modelo<select class="input" id="bk-model" ${target ? '' : 'disabled'}><option value="">${target ? 'Manter o atual' : 'Seleção com companhias diferentes: escolha a companhia'}</option>${models.map((m) => html`<option value="${m.id}" ${String(st.model_id) === String(m.id) ? 'selected' : ''}>${m.name} (${m.icao_type})</option>`)}</select>
          <span class="hint">Modelos vêm dos tipos do RPL e das listas; crie outros em "Modelos". Só associe se tiver certeza.</span></label>
        <div class="row" style="align-items:flex-end;flex-wrap:nowrap">
          <label class="field" style="flex:1">Definir campo<select class="input" id="bk-field"><option value="">— nenhum —</option>${fields.map((x) => html`<option value="${x.id}" ${String(st.field) === String(x.id) ? 'selected' : ''}>${x.label}${x.family ? ` (${x.family})` : ''}</option>`)}</select></label>
          ${fl ? (fl.kind === 'tri' ? html`<div class="tri-edit" id="bk-tri">${['SIM', 'NÃO', 'DESCONHECIDO'].map((o) => html`<button type="button" data-v="${o}" class="${st.value === o ? 'on' : ''}">${o === 'DESCONHECIDO' ? '?' : o}</button>`)}</div>`
            : fl.kind === 'select' ? html`<select class="input" id="bk-val" style="width:180px"><option value=""></option>${fl.options.map((o) => html`<option ${st.value === o ? 'selected' : ''}>${o}</option>`)}</select>`
            : html`<input class="input" id="bk-val" value="${st.value}" style="width:180px" placeholder="Valor">`) : ''}
        </div></div>`;
    };
    const m = openModal({ title: 'Alterar em lote', body: body(), foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-bk-save>Aplicar</button>` });
    const redraw = () => mount($('.modal-body', m.el), body());
    m.el.addEventListener('change', (e) => {
      if (e.target.id === 'bk-air') { st.airline = e.target.value; st.model_id = ''; st.field = ''; st.value = ''; redraw(); }
      if (e.target.id === 'bk-model') st.model_id = e.target.value;
      if (e.target.id === 'bk-field') { st.field = e.target.value; st.value = ''; redraw(); }
      if (e.target.id === 'bk-val') st.value = e.target.value;
    });
    m.el.addEventListener('input', (e) => { if (e.target.id === 'bk-val') st.value = e.target.value; });
    m.el.addEventListener('click', async (e) => {
      const tb = e.target.closest('#bk-tri button');
      if (tb) { st.value = tb.dataset.v; $$('#bk-tri button', m.el).forEach((x) => x.classList.toggle('on', x === tb)); return; }
      const sv = e.target.closest('[data-bk-save]'); if (!sv) return;
      if (!st.airline && !st.model_id && !(st.field && st.value)) { toast('Escolha ao menos uma alteração.', 'warn'); return; }
      const payload = { ids: chosen.map((x) => x.id) };
      if (st.airline) payload.airline = st.airline;
      if (st.model_id) payload.model_id = +st.model_id;
      if (st.field && st.value) payload.config = { [st.field]: st.value };
      await withBusy(sv, async () => {
        try { await api('/aircraft/bulk', { method: 'POST', body: payload }); toast(`${chosen.length} aeronave(s) atualizada(s).`); m.close(); sel.clear(); await refreshMeta(); drawAircraft(); } catch (er) { toastError(er); }
      });
    });
  }

  // ---------------------------------------------------------------- eventos gerais
  el.onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t && !t.closest('.modal, .drawer')) { tab = t.dataset.tab; draw(); return; }
    const a = e.target.closest('[data-a]');
    if (a) {
      if (a.dataset.a === 'new') openAircraft(null, true);
      if (a.dataset.a === 'export') { const q = new URLSearchParams({ status: 'all' }); if (f.airline) q.set('airline', f.airline); download('/api/aircraft/export.csv?' + q); }
      if (a.dataset.a === 'sel-nomodel') { items.filter((x) => !x.model_id && x.active).forEach((x) => sel.add(x.id)); bulkEdit(); return; }
      if (a.dataset.a === 'sel-clear') { sel.clear(); drawAircraft(); return; }
      if (a.dataset.a === 'bulk') { bulkEdit(); return; }
      if (a.dataset.a === 'demo') { try { const r = await api('/fleet/demo', { method: 'POST' }); toast(`${r.created} aeronave(s) fictícia(s) criada(s).`); await refreshMeta(); draw(); } catch (er) { toastError(er); } }
      return;
    }
    const rm = e.target.closest('[data-rmeq]');
    if (rm) { f.eq.splice(+rm.dataset.rmeq, 1); drawAircraft(); return; }
    if (e.target.closest('[data-sel], #ff-all')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr && tab === 'aeronaves') openAircraft(+tr.dataset.id);
  };
  let qTimer;
  el.oninput = (e) => { if (e.target.id === 'ff-q') { clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = e.target.value; drawAircraft().then(() => { const i = $('#ff-q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); } };
  el.onchange = (e) => {
    const id = e.target.id;
    if (id === 'ff-airline') { f.airline = e.target.value; f.model_id = ''; f.eq = []; sel.clear(); drawAircraft(); }
    if (id === 'ff-model') { f.model_id = e.target.value; drawAircraft(); }
    if (id === 'ff-status') { f.status = e.target.value; drawAircraft(); }
    if (id === 'ff-review') { f.review = e.target.checked ? '1' : ''; drawAircraft(); }
    if (id === 'ff-nomodel') { f.no_model = e.target.checked ? '1' : ''; sel.clear(); drawAircraft(); }
    if (id === 'ff-all') { items.forEach((x) => (e.target.checked ? sel.add(x.id) : sel.delete(x.id))); drawAircraft(); }
    if (e.target.dataset.sel) { const v = +e.target.dataset.sel; e.target.checked ? sel.add(v) : sel.delete(v); drawAircraft(); }
    if (id === 'ff-eqfield' && e.target.value) {
      const fid = e.target.value;
      openModal({ title: 'Filtro de equipamento', body: html`<div class="seg">${['SIM', 'NÃO', 'DESCONHECIDO'].map((v) => html`<button data-eqv="${v}" data-close>${v}</button>`)}</div>`,
        onMount: (box) => box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-eqv]'); if (b) { f.eq = f.eq.filter((x) => !x.startsWith(fid + ':')); f.eq.push(`${fid}:${b.dataset.eqv}`); drawAircraft(); } }) });
      e.target.value = '';
    }
  };
  await draw();
  return () => { el.onclick = null; el.oninput = null; el.onchange = null; };
}
