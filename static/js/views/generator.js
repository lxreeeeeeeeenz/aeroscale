import { api, html, mount, icon, state, $, $$, toastError, toast, withBusy, chipsInput, airline, fmtDate, isoDate, refreshMeta } from '../core.js';

const LS_KEY = 'aeroscale.generator';

function load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function save(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* */ } }

export async function render(el) {
  const m = state.meta;
  const s = m.settings;
  const prev = load();
  const withRpl = m.airlines.filter((a) => a.coverage);
  const st = {
    airline: prev.airline && withRpl.some((a) => a.code === prev.airline) ? prev.airline : (withRpl[0]?.code || m.airlines[0]?.code),
    kind: prev.kind || 'semanal',
    acMode: prev.acMode || 'auto',
    weekday_max: prev.weekday_max || (prev.weekdays ? Object.fromEntries([0, 1, 2, 3, 4, 5, 6].filter((i) => !prev.weekdays.includes(i)).map((i) => [String(i), 0])) : { ...(s.weekday_max || {}) }),
  };
  const DAYN = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const crewPrev = (k, d) => (prev[k] !== undefined ? prev[k] : (s[k] !== undefined ? s[k] : d));
  const now = new Date();
  const nextMonth = `${now.getFullYear() + (now.getMonth() === 11 ? 1 : 0)}-${String((now.getMonth() + 1) % 12 + 1).padStart(2, '0')}`;
  const firstCov = withRpl[0]?.coverage?.from || isoDate(now);

  mount(el, html`
    <div class="page-head">
      <div><h1>Gerar escala</h1><p class="lead">Monta uma sequência contínua de pernas reais do RPL para uma matrícula, respeitando tempo de solo, descanso e restrições da aeronave.</p></div>
    </div>
    ${!withRpl.length ? html`<div class="notice warn" style="margin-bottom:18px">${icon('alert')}<div><b>Nenhum RPL importado.</b> Importe os arquivos em <a href="#/importacoes">Importar RPL</a> antes de gerar escalas.</div></div>` : ''}
    <div class="grid grid-dash">
      <form class="panel" id="gen-form" novalidate>
        <fieldset class="fieldset"><legend><span class="step">1</span>Companhia e período</legend>
          <div class="stack">
            <div class="seg" id="seg-airline" role="radiogroup" aria-label="Companhia">${m.airlines.map((a) => html`<button type="button" data-v="${a.code}" class="${st.airline === a.code ? 'on' : ''}" style="color:${a.color}" ${a.coverage ? '' : html`title="Sem RPL importado"`}><span class="swatch" style="background:${a.color}"></span><span style="color:var(--text)">${a.code}</span><small class="muted">${a.name.split(' ')[0]}</small></button>`)}</div>
            <div class="seg" id="seg-kind" role="radiogroup" aria-label="Tipo de escala">
              <button type="button" data-v="semanal" class="${st.kind === 'semanal' ? 'on' : ''}">Semanal</button>
              <button type="button" data-v="mensal" class="${st.kind === 'mensal' ? 'on' : ''}">Mensal</button>
              <button type="button" data-v="avulsa" class="${st.kind === 'avulsa' ? 'on' : ''}">Avulsa</button>
            </div>
            <div class="form-grid">
              <label class="field" data-k="semanal">Início da semana<input class="input" type="date" name="week_start" value="${prev.week_start || firstCov}"></label>
              <label class="field" data-k="mensal">Mês<input class="input" type="month" name="month" value="${prev.month || nextMonth}"></label>
              <label class="field" data-k="avulsa">Data inicial<input class="input" type="date" name="start_date" value="${prev.start_date || firstCov}"></label>
              <label class="field" data-k="avulsa">Data final<input class="input" type="date" name="end_date" value="${prev.end_date || firstCov}"></label>
              <label class="field wide">Nome da escala <span class="hint">opcional</span><input class="input" name="name" placeholder="Gerado automaticamente"></label>
            </div>
          </div>
        </fieldset>

        <fieldset class="fieldset"><legend><span class="step">2</span>Aeronave</legend>
          <div class="stack">
            <div class="seg" id="seg-ac">
              <button type="button" data-v="auto" class="${st.acMode === 'auto' ? 'on' : ''}">Escolher automaticamente</button>
              <button type="button" data-v="specific" class="${st.acMode === 'specific' ? 'on' : ''}">Matrícula específica</button>
              <button type="button" data-v="type_only" class="${st.acMode === 'type_only' ? 'on' : ''}">Somente por tipo</button>
            </div>
            <div class="form-grid">
              <label class="field wide" data-ac="specific">Matrícula<select class="input" name="aircraft_id" id="ac-select"></select></label>
              <label class="field" data-ac="auto type_only">Tipo ICAO<select class="input" name="icao_type" id="type-select"></select></label>
            </div>
            <div data-ac="auto specific" id="equip-box"></div>
            <p class="hint" data-ac="type_only">Gera sem matrícula: útil enquanto a lista de frota não foi importada. As pernas ficam marcadas como "sem matrícula".</p>
          </div>
        </fieldset>

        <fieldset class="fieldset"><legend><span class="step">3</span>Aeroportos</legend>
          <div class="form-grid">
            <label class="field">Base / início<input class="input" name="base" list="ap-list" placeholder="Automática" value="${prev.base || ''}" style="text-transform:uppercase"><span class="hint">Vazio = aeroporto com mais partidas do tipo</span></label>
            <label class="field">Retorno à base<select class="input" name="return_to_base">
              <option value="none">Livre</option><option value="daily">Pernoitar na base todo dia</option><option value="end">Terminar na base</option></select></label>
            <div class="field wide"><span>Aeroportos de preferência</span><div class="chips-input" id="pref"></div></div>
            <div class="field wide"><span>Evitar como destino</span><div class="chips-input" id="avoid"></div></div>
          </div>
        </fieldset>

        <fieldset class="fieldset"><legend><span class="step">4</span>Pernas e tempos</legend>
          <div class="form-grid">
            <label class="field">Duração mín. da perna (min)<input class="input" type="number" min="0" name="leg_min_minutes" value="${prev.leg_min_minutes ?? 0}"></label>
            <label class="field">Duração máx. da perna (min)<input class="input" type="number" min="1" name="leg_max_minutes" value="${prev.leg_max_minutes ?? 600}"></label>
            <label class="field">Pernas por dia (mín.)<input class="input" type="number" min="0" max="12" name="legs_min" value="${prev.legs_min ?? s.legs_min}"></label>
            <label class="field">Pernas por dia (máx.)<input class="input" type="number" min="1" max="12" name="legs_max" value="${prev.legs_max ?? s.legs_max}"></label>
            <label class="field">Solo mínimo<select class="input" name="turn_mode"><option value="auto">Automático (medido no RPL)</option><option value="fixed">Valor fixo</option></select></label>
            <label class="field" id="mt-wrap">Solo mínimo fixo (min)<input class="input" type="number" min="10" name="min_turn" value="${prev.min_turn ?? s.min_turn_min}"></label>
            <label class="field">Solo máximo (min)<input class="input" type="number" min="10" name="max_turn" value="${prev.max_turn ?? s.max_turn_min}"></label>
            <label class="field">Descanso noturno mín. (min)<input class="input" type="number" min="0" name="min_rest" value="${prev.min_rest ?? s.min_rest_min}"></label>
            <label class="field">Janela de partidas (local)<div class="row" style="flex-wrap:nowrap"><input class="input" type="time" name="day_start" value="${prev.day_start || s.day_start}"><span class="muted">a</span><input class="input" type="time" name="day_end" value="${prev.day_end || s.day_end}"></div></label>
            <div class="field full"><span>Máximo de pernas por dia da semana</span>
              <div class="wk-grid" id="wkgrid">${DAYN.map((dn, i) => html`<label class="wk-cell ${st.weekday_max[String(i)] === 0 ? 'off' : ''}"><span>${dn}</span>
                <select class="input sm" data-wk="${i}"><option value="">Padrão</option><option value="0" ${st.weekday_max[String(i)] === 0 ? 'selected' : ''}>Folga</option>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<option value="${n}" ${st.weekday_max[String(i)] === n ? 'selected' : ''}>até ${n}</option>`)}</select></label>`)}</div>
              <span class="hint">"Padrão" usa o máximo de pernas por dia acima; o limite do dia tem prioridade. Ex.: terça "até 1", quinta "Folga".</span></div>
            <label class="field">Compatibilidade de tipo<select class="input" name="type_match"><option value="exact">Exata (mesmo designador)</option><option value="family">Mesma família (sinaliza)</option></select></label>
          </div>
          <div class="stack" style="margin-top:14px">
            <label class="check"><input type="checkbox" name="projection" ${(prev.projection ?? s.projection_enabled) ? 'checked' : ''}> Projetar o padrão semanal do RPL fora da validade (pernas marcadas como projetadas)</label>
            <label class="check"><input type="checkbox" name="avoid_used" ${(prev.avoid_used ?? s.avoid_used_flights) ? 'checked' : ''}> Não reutilizar voos já atribuídos em outras escalas</label>
            <label class="check"><input type="checkbox" name="model_realism" ${(prev.model_realism ?? s.model_realism ?? true) ? 'checked' : ''}> Priorizar sequências prováveis (modelo de rodízio calibrado com rodízios reais: bate-voltas com número consecutivo, continuação do mesmo voo)</label>
            <label class="check"><input type="checkbox" name="allow_positioning" ${prev.allow_positioning ? 'checked' : ''}> Permitir pernas de posicionamento sugeridas quando a aeronave ficar sem voos (sem número de voo, marcadas como sugestão)</label>
            <label class="field" style="max-width:340px">Chance de anormalidade: repetição de trecho (% dos dias)<input class="input" type="number" min="0" max="100" name="anomaly_repeat_pct" value="${prev.anomaly_repeat_pct ?? s.anomaly_repeat_pct ?? 5}"><span class="hint">Fora desses dias o gerador evita vai-e-volta repetido no mesmo par.</span></label>
          </div>
        </fieldset>

        <fieldset class="fieldset"><legend><span class="step">5</span>Regras de tripulação</legend>
          <div class="form-grid">
            <label class="field wide">Perfil<select class="input" name="crew_mode">
              <option value="rbac117">RBAC 117 – jornada conforme horário de apresentação e etapas (GOL, LATAM, Azul)</option>
              <option value="lei">Lei 13.475 estrita – 9 h de jornada, 8 h de voo, 4 pousos</option>
              <option value="off">Desligado – só os tempos acima</option></select></label>
            <label class="field">Folgas mínimas/mês<input class="input" type="number" min="0" max="20" name="days_off_min" value="${crewPrev('days_off_min', 10)}"></label>
            <label class="field">Máx. dias seguidos<input class="input" type="number" min="1" max="21" name="max_consecutive_days" value="${crewPrev('max_consecutive_days', 6)}"></label>
          </div>
          <div class="stack" style="margin-top:12px" id="crew-opts">
            <label class="check"><input type="checkbox" name="crew_days_off" ${crewPrev('crew_days_off', true) ? 'checked' : ''}> Folgas regulamentares: mínimo mensal proporcional, folga após no máximo 6 dias e um sábado+domingo no mês; retorno da folga a partir das 10:00</label>
            <label class="check"><input type="checkbox" name="crew_folga_base" ${crewPrev('crew_folga_base', true) ? 'checked' : ''}> Folga começa na base (o dia anterior à folga termina na base)</label>
            <label class="check"><input type="checkbox" name="crew_madrugada" ${crewPrev('crew_madrugada', true) ? 'checked' : ''}> Madrugadas: no máximo 2 seguidas e 4 em 7 dias (00:00–06:00)</label>
            <label class="check"><input type="checkbox" name="crew_monthly" ${crewPrev('crew_monthly', true) ? 'checked' : ''}> Limites de 80 h de voo/mês (jato) ou 85 h (turboélice), 44 h semanais e 176 h mensais de jornada</label>
          </div>
          <p class="hint" style="margin-top:10px">Sempre aplicados com o perfil ligado: apresentação 30 min antes e fim 30 min após o corte, repouso de 12/16/24 h conforme a jornada (Lei 13.475 art. 48). Regras internas de cada empresa (acordos coletivos) não são públicas; ajuste os limites acima se quiser algo mais restrito.</p>
          <div class="row" style="margin-top:10px"><button type="button" class="btn sm" id="save-default">${icon('check')}Salvar dias da semana e regras como padrão</button></div>
        </fieldset>
        <fieldset class="fieldset"><legend><span class="step">6</span>Reserva automática</legend>
          <div class="form-grid">
            <label class="field">Blocos de reserva<select class="input" name="reserve_blocks">
              <option value="">Padrão (semanal 1, mensal ${s.reserve_enabled === false ? '0' : s.reserve_per_month ?? 1}, avulsa 0)</option>
              ${[0, 1, 2, 3].map((n) => html`<option value="${n}" ${String(prev.reserve_blocks ?? '') === String(n) ? 'selected' : ''}>${n === 0 ? 'Sem reserva' : `${n} bloco(s)`}</option>`)}</select></label>
            <label class="field">Duração (dias)<div class="row" style="flex-wrap:nowrap"><input class="input" type="number" min="3" max="9" name="reserve_min_days" value="${prev.reserve_min_days ?? s.reserve_min_days ?? 3}"><span class="muted">a</span><input class="input" type="number" min="3" max="9" name="reserve_max_days" value="${prev.reserve_max_days ?? s.reserve_max_days ?? 9}"></div><span class="hint">Sorteada entre 3 e 9 dias seguidos.</span></label>
            <label class="field">Chance de ser na base (%)<input class="input" type="number" min="0" max="100" name="reserve_base_pct" value="${prev.reserve_base_pct ?? s.reserve_base_pct ?? 80}"><span class="hint">Senão, outro aeroporto da operação.</span></label>
            <label class="field">Chance de acionamento (%)<input class="input" type="number" min="0" max="100" name="reserve_activation_pct" value="${prev.reserve_activation_pct ?? s.reserve_activation_pct ?? 50}"></label>
            <label class="field">Acionamento dura até (dias)<input class="input" type="number" min="1" max="9" name="reserve_activation_max_days" value="${prev.reserve_activation_max_days ?? s.reserve_activation_max_days ?? 3}"></label>
          </div>
          <p class="hint" style="margin-top:10px">O bloco de reserva é garantido e não ocupa indisponibilidade nem folga fixa do dia da semana; as folgas regulamentares são planejadas em volta. Local e acionamento são sorteados uma vez e ficam salvos na escala. Acionada, a reserva recebe voos reais do RPL que saem do local da reserva e voltam a ele; sem sequência compatível, o acionamento fica registrado como inviável, sem inventar voos.</p>
        </fieldset>
        <div class="row"><button class="btn primary" id="gen-btn" type="submit">${icon('wand')}Gerar escala</button><span class="hint" id="gen-hint"></span></div>
      </form>

      <aside class="stack" style="gap:18px">
        <section class="panel" id="cov-panel"></section>
        <section class="panel">
          <h3 style="margin-bottom:10px">Como a escala é montada</h3>
          <ol class="text-2" style="margin:0;padding-left:18px;display:grid;gap:8px;font-size:13.5px">
            <li>Para cada dia, só entram voos que existem no RPL naquela data (ou projetados, se permitido), do mesmo tipo da aeronave.</li>
            <li>A próxima perna sempre parte do aeroporto onde a anterior chegou, respeitando o tempo de solo.</li>
            <li>Entre dias é aplicado o descanso mínimo; a aeronave dorme onde terminou.</li>
            <li>Indisponibilidades e aeroportos restritos da matrícula são respeitados.</li>
            <li>O RPL não informa matrículas: o encadeamento é uma <b>sugestão</b> coerente, não o rodízio real da companhia.</li>
          </ol>
        </section>
      </aside>
    </div>
    <datalist id="ap-list">${m.airports.map((a) => html`<option value="${a.icao}">${a.city || ''} ${a.iata || ''}</option>`)}</datalist>`);

  const form = $('#gen-form', el);
  const pref = chipsInput($('#pref', el), prev.preferred_airports || []);
  const avoid = chipsInput($('#avoid', el), prev.avoid_airports || []);
  form.return_to_base.value = prev.return_to_base || 'none';
  form.type_match.value = prev.type_match || 'exact';
  form.turn_mode.value = crewPrev('turn_mode', 'auto');
  form.crew_mode.value = crewPrev('crew_mode', 'rbac117');
  const syncTurn = () => { $('#mt-wrap', el).hidden = form.turn_mode.value !== 'fixed'; };
  const syncCrew = () => { $('#crew-opts', el).style.opacity = form.crew_mode.value === 'off' ? '.45' : '1'; };
  syncTurn(); syncCrew();
  const crewBody = () => ({ crew_mode: form.crew_mode.value, crew_days_off: form.crew_days_off.checked, crew_folga_base: form.crew_folga_base.checked,
    crew_madrugada: form.crew_madrugada.checked, crew_monthly: form.crew_monthly.checked, days_off_min: form.days_off_min.value,
    max_consecutive_days: form.max_consecutive_days.value, turn_mode: form.turn_mode.value });
  let aircraft = [];

  const seg = (id, key, cb) => $(id, el).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    st[key] = b.dataset.v; $$(`${id} button`, el).forEach((x) => x.classList.toggle('on', x === b)); cb?.();
  });

  function syncKind() { $$('[data-k]', el).forEach((x) => { x.hidden = x.dataset.k !== st.kind; }); }
  function syncAc() { $$('[data-ac]', el).forEach((x) => { x.hidden = !x.dataset.ac.split(' ').includes(st.acMode); }); drawEquip(); }

  function drawEquip() {
    const box = $('#equip-box', el);
    const fields = m.fields.filter((f) => f.active && f.kind === 'tri' && (!f.airline || f.airline === st.airline));
    if (!fields.length) { mount(box, html`<p class="hint">Sem campos de configuração para ${st.airline}. Crie em Frota → Campos.</p>`); return; }
    mount(box, html`<div class="field"><span>Requisitos de equipamento ${st.acMode === 'specific' ? '(apenas conferência)' : ''}</span>
      <div class="form-grid">${fields.map((f) => html`<label class="field">${f.label}${f.family ? html` <span class="hint">família ${f.family}</span>` : ''}
        <select class="input sm" data-eq="${f.id}"><option value="">Indiferente</option><option value="SIM">Exigir SIM</option><option value="NÃO">Exigir NÃO</option></select></label>`)}</div>
      <span class="hint">DESCONHECIDO nunca conta como SIM.</span></div>`);
    const eq = prev.equipment || {};
    $$('[data-eq]', box).forEach((s2) => { s2.value = eq[s2.dataset.eq] || ''; });
  }

  async function syncAirline() {
    const a = airline(st.airline);
    const types = a.types || [];
    mount($('#type-select', el), html`<option value="">${st.acMode === 'type_only' ? 'Selecione' : 'Qualquer tipo'}</option>${types.map((t) => html`<option value="${t}">${t} – ${m.type_info[t]?.name || t}</option>`)}`);
    if (prev.icao_type && types.includes(prev.icao_type)) $('#type-select', el).value = prev.icao_type;
    try { aircraft = (await api(`/aircraft?airline=${st.airline}&status=active`)).items; } catch (e) { toastError(e); aircraft = []; }
    mount($('#ac-select', el), aircraft.length ? aircraft.map((x) => html`<option value="${x.id}">${x.registration} · ${x.icao_type || 'sem modelo'}${x.is_demo ? ' · FICTÍCIA' : ''}${x.icao_type && !types.includes(x.icao_type) ? ' · tipo fora do RPL' : ''}</option>`) : html`<option value="">Nenhuma aeronave ativa de ${st.airline}</option>`);
    if (prev.aircraft_id && aircraft.some((x) => String(x.id) === String(prev.aircraft_id))) $('#ac-select', el).value = prev.aircraft_id;
    drawEquip();
    drawCoverage();
  }

  function periodOf() {
    if (st.kind === 'mensal') { const [y, mo] = form.month.value.split('-').map(Number); if (!y) return null; return [`${form.month.value}-01`, isoDate(new Date(y, mo, 0))]; }
    if (st.kind === 'semanal') { if (!form.week_start.value) return null; const d = new Date(form.week_start.value + 'T00:00'); d.setDate(d.getDate() + 6); return [form.week_start.value, isoDate(d)]; }
    return form.start_date.value ? [form.start_date.value, form.end_date.value || form.start_date.value] : null;
  }

  function drawCoverage() {
    const a = airline(st.airline);
    const per = periodOf();
    let status = '';
    if (a.coverage && per) {
      const inside = per[0] >= a.coverage.from && per[1] <= a.coverage.to;
      const outside = per[1] < a.coverage.from || per[0] > a.coverage.to;
      status = inside ? html`<div class="notice" style="border-color:rgba(61,220,151,.35)">${icon('check')}<div>Período dentro da validade: todas as pernas serão <b>voos reais</b> do RPL.</div></div>`
        : html`<div class="notice warn">${icon('alert')}<div>Período ${outside ? 'fora' : 'parcialmente fora'} da validade do RPL (${fmtDate(a.coverage.from, { year: false })} a ${fmtDate(a.coverage.to)}). ${form.projection.checked ? html`Dias fora serão <b>projetados</b> pelo padrão semanal (não garantidos).` : html`Com a projeção desligada, dias fora da validade ficarão vazios.`}</div></div>`;
    }
    const acCount = aircraft.length;
    mount($('#cov-panel', el), html`
      <div class="panel-head"><h3>${a.name}</h3></div>
      <dl class="kv">
        <dt>Validade do RPL</dt><dd>${a.coverage ? `${fmtDate(a.coverage.from)} a ${fmtDate(a.coverage.to)}` : html`<span style="color:var(--warn)">sem RPL importado</span>`}</dd>
        <dt>Registros</dt><dd>${a.coverage ? a.coverage.records.toLocaleString('pt-BR') : '—'}</dd>
        <dt>Tipos no RPL</dt><dd>${(a.types || []).join(', ') || '—'}</dd>
        <dt>Aeronaves ativas</dt><dd>${acCount}${acCount ? '' : html` · <a href="#/frota?tab=importar">importar lista</a>`}${aircraft.some((x) => !x.icao_type) ? html`<br><a href="#/frota?airline=${st.airline}&sem_modelo=1" style="color:var(--warn)">${aircraft.filter((x) => !x.icao_type).length} sem modelo: associar</a>` : ''}</dd>
        <dt>Período</dt><dd>${per ? `${fmtDate(per[0])} a ${fmtDate(per[1])}` : '—'}</dd>
      </dl>
      ${status ? html`<div style="margin-top:14px">${status}</div>` : ''}`);
  }

  seg('#seg-airline', 'airline', syncAirline);
  seg('#seg-kind', 'kind', () => { syncKind(); drawCoverage(); });
  seg('#seg-ac', 'acMode', syncAc);
  $('#wkgrid', el).addEventListener('change', (e) => {
    const sel = e.target.closest('[data-wk]'); if (!sel) return;
    if (sel.value === '') delete st.weekday_max[sel.dataset.wk]; else st.weekday_max[sel.dataset.wk] = +sel.value;
    sel.closest('.wk-cell').classList.toggle('off', sel.value === '0');
  });
  form.addEventListener('change', (e) => {
    if (['month', 'week_start', 'start_date', 'end_date', 'projection'].includes(e.target.name)) drawCoverage();
    if (e.target.name === 'turn_mode') syncTurn();
    if (e.target.name === 'crew_mode') syncCrew();
  });
  $('#save-default', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try { await api('/settings', { method: 'PUT', body: { weekday_max: st.weekday_max, ...crewBody() } }); await refreshMeta(); toast('Padrão salvo: vale para as próximas escalas e para Configurações.'); } catch (er) { toastError(er); }
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form;
    const equipment = {};
    $$('[data-eq]', el).forEach((s2) => { if (s2.value) equipment[s2.dataset.eq] = s2.value; });
    const p = {
      airline: st.airline, kind: st.kind, name: f.name.value,
      start_date: st.kind === 'semanal' ? f.week_start.value : f.start_date.value, end_date: f.end_date.value, month: f.month.value,
      aircraft_mode: st.acMode, aircraft_id: st.acMode === 'specific' ? f.aircraft_id.value : null,
      icao_type: f.icao_type.value || null, base: f.base.value.trim().toUpperCase(), return_to_base: f.return_to_base.value,
      preferred_airports: pref.get(), avoid_airports: avoid.get(),
      leg_min_minutes: f.leg_min_minutes.value, leg_max_minutes: f.leg_max_minutes.value, legs_min: f.legs_min.value, legs_max: f.legs_max.value,
      min_turn: f.min_turn.value, max_turn: f.max_turn.value, min_rest: f.min_rest.value, day_start: f.day_start.value, day_end: f.day_end.value,
      weekday_max: st.weekday_max, type_match: f.type_match.value, projection: f.projection.checked, avoid_used: f.avoid_used.checked,
      allow_positioning: f.allow_positioning.checked, model_realism: f.model_realism.checked, anomaly_repeat_pct: f.anomaly_repeat_pct.value, equipment, ...crewBody(),
      reserve_blocks: f.reserve_blocks.value, reserve_min_days: f.reserve_min_days.value, reserve_max_days: f.reserve_max_days.value,
      reserve_base_pct: f.reserve_base_pct.value, reserve_activation_pct: f.reserve_activation_pct.value,
      reserve_activation_max_days: f.reserve_activation_max_days.value,
    };
    if (st.acMode === 'specific' && !p.aircraft_id) { toast('Selecione uma matrícula ou mude para escolha automática.', 'warn'); return; }
    if (st.acMode === 'type_only' && !p.icao_type) { toast('Selecione o tipo ICAO.', 'warn'); return; }
    if ([0, 1, 2, 3, 4, 5, 6].every((i) => st.weekday_max[String(i)] === 0)) { toast('Todos os dias estão como folga.', 'warn'); return; }
    save({ ...p, acMode: st.acMode, week_start: f.week_start.value, name: undefined });
    await withBusy($('#gen-btn', el), async () => {
      try {
        const r = await api('/schedules/generate', { method: 'POST', body: p });
        toast(`Escala criada: ${r.summary.legs} pernas (${r.summary.by_origin.REAL} reais, ${r.summary.by_origin.PROJETADO} projetadas).`, r.summary.legs ? 'ok' : 'warn');
        location.hash = `#/escalas/${r.id}`;
      } catch (err) { toastError(err); }
    });
  });

  syncKind(); syncAc();
  await syncAirline();
}
