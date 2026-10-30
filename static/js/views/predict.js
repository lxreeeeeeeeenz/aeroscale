import { api, html, mount, icon, state, $, toastError, withBusy, isoDate, fmtDur, airlineTag, originBadge } from '../core.js';

const CONF = { alta: 'ok', 'média': 'warn', baixa: 'err' };
const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const hm = (s) => (s || '').slice(11, 16);
const dm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const FEATS = {
  same_ident: 'Mesmo número de voo continua (voo com escalas) – a aeronave quase sempre é a mesma',
  pair_return: 'Bate-volta com número consecutivo (ex.: G31854 ida, G31855 volta)',
  reverse: 'Volta para o aeroporto de onde a aeronave veio',
  turn_slope: 'Penalidade por hora de solo acima do típico',
  long_ground: 'Penalidade extra para aeronave parada > 4 h durante o dia',
  overnight: 'Custo de encerrar o dia (pernoite) em vez de seguir voando',
  first_bank: 'Bônus ao primeiro voo da manhã após pernoite',
  type_exact: 'Tipo registrado no RPL igual ao da aeronave',
  freq: 'Regularidade: dias por semana em que o voo opera',
};

export async function render(el) {
  const m = state.meta;
  const withRpl = m.airlines.filter((a) => a.coverage);
  mount(el, html`
    <div class="page-head"><div><h1>Previsões de rodízio</h1><p class="lead">Estimativa estatística de qual voo do RPL a mesma aeronave provavelmente faz em seguida: bate-voltas, pernoites, continuação de rota e lacunas. Previsões nunca viram dados confirmados.</p></div></div>
    <form class="panel" id="pf"><div class="form-grid">
      <label class="field">Companhia<select class="input" name="airline">${withRpl.map((a) => html`<option value="${a.code}">${a.code} – ${a.name}</option>`)}</select></label>
      <label class="field">Voo<input class="input" name="ident" placeholder="ex.: G31854, AD4338, LA3768" required style="text-transform:uppercase"></label>
      <label class="field">Data (UTC do EOBT)<input class="input" type="date" name="date" value="${withRpl[0]?.coverage?.from || isoDate(new Date())}"></label>
      <label class="field">Tipo da aeronave<select class="input" name="type"></select></label>
      <label class="field">Compatibilidade<select class="input" name="type_mode"><option value="family">Mesma família (recomendado)</option><option value="exact">Tipo exato</option></select></label>
      <div class="field" style="align-self:end"><button class="btn primary" type="submit" id="pgo">${icon('chart')}Prever continuação</button></div>
    </div><p class="hint" style="margin-top:8px">Nas amostras observadas, aeronaves voaram voos registrados no RPL com outro tipo da mesma família (B738 ↔ B38M, A320 ↔ A321). Por isso a família é o padrão.</p></form>
    <div id="pres" style="margin-top:18px"></div>
    <section class="panel" style="margin-top:18px" id="pq"><div class="skeleton"></div></section>`);

  const f = $('#pf', el);
  const syncTypes = () => { const a = m.airlines.find((x) => x.code === f.airline.value); mount(f.type, html`<option value="">Qualquer</option>${(a?.types || []).map((t) => html`<option>${t}</option>`)}`); };
  f.airline.addEventListener('change', syncTypes); syncTypes();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('#pgo', el), async () => {
      try {
        const q = new URLSearchParams({ airline: f.airline.value, ident: f.ident.value.trim(), date: f.date.value, type: f.type.value, type_mode: f.type_mode.value });
        const r = await api('/predict/next?' + q);
        mount($('#pres', el), html`<div class="notice info" style="margin-bottom:12px">${icon('info')}<div>${r.seasonality}</div></div>${r.items.map(resultHTML)}`);
      } catch (er) { toastError(er); }
    });
  });

  try {
    const q = await api('/predict/quality');
    mount($('#pq', el), html`<div class="panel-head"><h2>Qualidade do modelo</h2><span class="muted small">medida nas amostras observadas (rodízios reais de 23 a 31/10/2026)</span></div>
      <div class="stat-line" style="margin-bottom:14px">
        <div><div class="v">${q.transitions}</div><div class="l">transições avaliadas (${q.skipped} ignoradas: atraso > 60 min, voo fora do RPL ou troca de aeronave)</div></div>
        <div><div class="v" style="color:var(--real)">${pct(q.top1_rate)}</div><div class="l">próxima perna real em 1º lugar</div></div>
        <div><div class="v" style="color:var(--proj)">${pct(q.top3_rate)}</div><div class="l">entre as 3 primeiras</div></div>
        <div><div class="v">${q.mean_loglik}</div><div class="l">log-verossimilhança média (maior é melhor)</div></div>
      </div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Amostra</th><th class="num">Pernas</th><th class="num">No RPL</th><th class="num">Transições</th><th class="num">1º lugar</th><th class="num">Top 3</th><th>Base estimada</th><th>Pernoites</th><th>Bate-voltas (nº consecutivo)</th></tr></thead><tbody>
        ${q.samples.map((s) => html`<tr class="clickable" data-s="${s.id}"><td>${airlineTag(s.airline)} ${s.label}</td><td class="num">${s.legs}</td><td class="num">${s.matched}</td><td class="num">${s.transitions}</td><td class="num">${s.top1}</td><td class="num">${s.top3}</td>
          <td>${s.analysis.base || '—'} <span class="badge ${CONF[s.analysis.base_confidence]}">${s.analysis.base_confidence}</span></td><td class="small">${s.analysis.overnights.join(', ') || '—'}</td><td>${s.analysis.turnbacks} (${s.analysis.paired_turnbacks})</td></tr>
          <tr hidden data-sd="${s.id}"><td colspan="9"><div class="row" style="gap:6px">${s.details.map((d) => html`<span class="badge ${d.rank === 1 ? 'ok' : d.rank && d.rank <= 3 ? 'warn' : 'err'}" title="probabilidade ${pct(d.p)} entre ${d.n} candidatos">${d.from}→${d.to}: ${d.rank ? `${d.rank}º` : 'fora'}</span>`)}</div></td></tr>`)}
      </tbody></table></div>
      <h3 style="margin:18px 0 8px">Como a pontuação é feita</h3>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Característica</th><th class="num">Peso</th></tr></thead><tbody>
        ${Object.entries(q.weights).map(([k, v]) => html`<tr><td>${FEATS[k] || k}</td><td class="num">${v}</td></tr>`)}
        <tr><td>Solo considerado típico (sem penalidade)</td><td class="num">${q.turn_typical} min</td></tr></tbody></table></div>
      <p class="hint" style="margin-top:8px">Modelo log-linear: a pontuação de cada voo candidato é a soma dos pesos; a probabilidade é a pontuação normalizada entre todos os voos compatíveis que partem do aeroporto nas 22 h seguintes. Confiança: alta (≥ 60%, ou ≥ 45% com evidência estrutural), média (≥ 30%), baixa (abaixo disso). Pesos calibrados nas amostras; sem histórico por matrícula, o modelo usa estas regras transparentes.</p>`);
    $('#pq', el).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-s]'); if (tr) { const d = el.querySelector(`[data-sd="${tr.dataset.s}"]`); d.hidden = !d.hidden; } });
  } catch (er) { mount($('#pq', el), html`<div class="notice warn">${icon('alert')}<div>${er.message}</div></div>`); }
}

function resultHTML(it) {
  const c = it.current;
  return html`<section class="panel" style="margin-bottom:18px">
    <div class="panel-head"><h2>${c.ident} ${c.adep} → ${c.ades}</h2>${originBadge(c.origin)}<span class="muted">${dm(c.dep_local)} ${hm(c.dep_local)} – ${hm(c.arr_local)} · ${c.type_icao}</span><span class="muted small">${it.n} candidato(s)</span></div>
    ${it.candidates.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Voo</th><th>Trecho</th><th>Partida</th><th>Intervalo</th><th>Prob.</th><th>Confiança</th><th>Por quê</th></tr></thead><tbody>
      ${it.candidates.map((x) => html`<tr><td class="strong">${x.ident}</td><td>${x.adep} → ${x.ades}</td><td>${dm(x.dep_local)} ${hm(x.dep_local)}</td><td class="small">${x.gap_label}<br><span class="muted">${fmtDur(x.ground_min)}</span></td>
        <td><div class="row" style="gap:8px;flex-wrap:nowrap"><span class="duty-bar"><i style="width:${Math.round(x.p * 100)}%;background:var(--sugg)"></i></span>${pct(x.p)}</div></td>
        <td><span class="badge ${CONF[x.confidence]}" title="${x.confidence_note}">${x.confidence}</span></td>
        <td class="small text-2">${x.reasons.filter((r) => r.weight !== 0).map((r) => html`<div>${r.weight > 0 ? '+' : '−'} ${r.text}</div>`)}${x.origin === 'PROJETADO' ? html`<div>projetado do padrão semanal</div>` : ''}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">Nenhum voo compatível parte de ${c.ades} nas 22 h seguintes.</p>`}
    ${it.chain.length ? html`<h3 style="margin:16px 0 8px">Sequência mais provável</h3><div class="chain">${it.chain.map((x, i) => html`<div class="chain-step"><span class="muted small">${x.gap_label} · ${fmtDur(x.ground_min)}</span><b>${x.ident}</b><span>${x.adep} → ${x.ades}</span><span class="muted small">${dm(x.dep_local)} ${hm(x.dep_local)}</span><span class="badge ${CONF[x.confidence]}">${pct(x.p)} · acumulada ${pct(x.chain_p)}</span></div>`)}</div>
      <p class="hint" style="margin-top:6px">A probabilidade acumulada cai a cada passo: quanto mais longe, menos confiável.</p>` : ''}
  </section>`;
}
