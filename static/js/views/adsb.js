import { api, html, mount, icon, state, $, toast, toastError, withBusy, fmtDur, airlineTag, openModal, confirmDialog, refreshMeta, fmtDate, download } from '../core.js';

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const hm = (s) => (s || '').slice(11, 16);
const dm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const FEATS = {
  same_ident: 'Mesmo número de voo continua', pair_return: 'Bate-volta com número consecutivo', reverse: 'Volta para a origem anterior',
  turn_slope: 'Penalidade por hora de solo acima do típico', long_ground: 'Parada diurna > 4 h', overnight: 'Custo de pernoitar',
  first_bank: 'Primeira saída da manhã', type_exact: 'Tipo do RPL igual ao da aeronave', freq: 'Regularidade semanal do voo',
};

function yesterdayUTC(n = 1) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function render(el) {
  let timer = null;
  let filter = { airline: '', q: '', fleet: '' };
  mount(el, html`
    <div class="page-head"><div><h1>Dados ADS-B (adsb.lol)</h1>
      <p class="lead">Matrículas reais e rodízio observado de GOL, LATAM e Azul, lidos do histórico aberto do adsb.lol (licença ODbL). Serve para completar a frota e calibrar o modelo de rodízio com dados reais.</p></div></div>
    <form class="panel" id="ad-form">
      <div class="form-grid">
        <label class="field">De<input class="input" type="date" name="from" value="${yesterdayUTC(3)}" max="${yesterdayUTC(1)}"></label>
        <label class="field">Até<input class="input" type="date" name="to" value="${yesterdayUTC(1)}" max="${yesterdayUTC(1)}"></label>
        <label class="field">Indicativos<input class="input" name="prefixes" value="${state.meta.settings.adsb_prefixes || 'GLO,TAM,AZU'}" style="text-transform:uppercase"><span class="hint">GLO = GOL, TAM = LATAM, AZU = Azul.</span></label>
        <div class="field" style="align-self:end"><button class="btn primary" id="ad-go" type="submit">${icon('download')}Baixar e processar</button></div>
      </div>
      <div class="row" style="margin-top:8px;gap:18px">
        <label class="check"><input type="checkbox" name="reprocess"> Reprocessar dias já lidos</label>
        <label class="check"><input type="checkbox" name="all_hex"> Incluir aeronaves com matrícula estrangeira (bem mais lento)</label>
      </div>
      <p class="hint" style="margin-top:8px">Cada dia é um pacote de cerca de 3,8 GB no GitHub. O AeroScale lê direto da rede e guarda só o resumo das companhias escolhidas, sem gravar o pacote no disco. Quantidade baixada: ~3 GB por dia (com 100 Mbit/s, uns 5–6 min por dia). O dia sai cerca de 1 dia depois. Mais dias = mais matrículas (aeronaves em manutenção ou fora da cobertura aparecem em outros dias).</p>
    </form>
    <div id="ad-job"></div>
    <div id="ad-body" style="margin-top:18px"><div class="skeleton"></div></div>`);

  const f = $('#ad-form', el);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('#ad-go', el), async () => {
      try {
        await api('/adsb/jobs', { method: 'POST', body: { from: f.from.value, to: f.to.value, prefixes: f.prefixes.value, reprocess: f.reprocess.checked, all_hex: f.all_hex.checked } });
        poll();
      } catch (er) { toastError(er); }
    });
  });

  let wasRunning = false;
  async function poll() {
    clearTimeout(timer);
    let j;
    try { j = await api('/adsb/jobs/current'); } catch { return; }
    drawJob(j);
    if (j.state === 'running') {
      if (wasRunning && j.done.length !== drawJob.lastDone) load();  // um dia terminou: atualiza as tabelas
      drawJob.lastDone = j.done.length;
      wasRunning = true;
      timer = setTimeout(poll, 1500);
    } else if (wasRunning) {
      wasRunning = false;
      load();
    }
  }

  function drawJob(j) {
    const box = $('#ad-job', el);
    if (!j || j.state === 'idle') { mount(box, ''); return; }
    const running = j.state === 'running';
    const pctv = j.position_pct || 0;
    mount(box, html`<section class="panel" style="margin-top:14px">
      <div class="panel-head"><h2>${running ? 'Lendo o histórico…' : j.state === 'cancelled' ? 'Leitura cancelada' : 'Leitura concluída'}</h2>
        <span class="muted small">${j.days.length} dia(s): ${j.done.length} lido(s), ${j.skipped.length} pulado(s), ${j.failed.length} com falha</span>
        ${running ? html`<button class="btn sm danger" id="ad-cancel" type="button">${icon('x')}Cancelar</button>` : ''}</div>
      ${running ? html`<p class="text-2">${j.current ? fmtDate(j.current, { weekday: true }) : ''} · ${j.stage}${j.total_mb ? ` · ${j.downloaded_mb} MB baixados (posição ${pctv}% de ${j.total_mb} MB)` : ''}</p>
        <div class="progress"><i style="width:${pctv}%"></i></div>` : ''}
      ${j.failed.length ? html`<div class="strip-checks" style="margin-top:8px">${j.failed.map((x) => html`<div class="warning">${icon('alert')}${dm(x.day)}: ${x.error}</div>`)}</div>` : ''}
      <details style="margin-top:8px" ${running ? '' : 'open'}><summary class="muted small">Registro</summary><pre class="log">${(j.log || []).join('\n') || '—'}</pre></details>
    </section>`);
    const c = $('#ad-cancel', el);
    if (c) c.onclick = async () => { await api('/adsb/jobs/cancel', { method: 'POST' }); poll(); };
  }

  async function load() {
    let s;
    try { s = await api('/adsb/summary'); } catch (er) { toastError(er); return; }
    const body = $('#ad-body', el);
    if (!s.days.length) {
      mount(body, html`<div class="empty"><h3>Nenhum dia lido ainda</h3><p>Escolha um período acima. Três dias já trazem a maior parte da frota ativa das três companhias.</p></div>`);
      return;
    }
    mount(body, html`
      <div class="grid grid-3">${s.airlines.map((a) => html`<section class="panel">
        <div class="panel-head"><h2>${airlineTag(a.airline)} ${a.n} matrícula(s)</h2></div>
        <p class="text-2">${a.in_fleet} já na frota · <b>${a.n - a.in_fleet - a.no_reg - a.suspects}</b> nova(s)${a.suspects ? ` · ${a.suspects} para conferir` : ''}${a.no_reg ? ` · ${a.no_reg} sem matrícula no banco do ADS-B` : ''}</p>
        <div class="row" style="gap:4px;margin:8px 0">${a.types.map((t) => html`<span class="badge">${t.t} · ${t.n}</span>`)}</div>
        <button class="btn sm ${a.n - a.in_fleet - a.no_reg - a.suspects ? 'primary' : ''}" data-fleet="${a.airline}" type="button">${icon('plus')}Adicionar à frota</button>
      </section>`)}</div>

      <section class="panel" style="margin-top:18px">
        <div class="panel-head"><h2>Dias lidos</h2><span class="muted small">${s.legs} perna(s) observadas, ${s.legs_rpl} ligadas a voos do RPL</span>
          <button class="btn sm ghost" type="button" id="ad-rematch" title="Use depois de importar um RPL novo">${icon('refresh')}Religar ao RPL</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Dia</th><th class="num">Aeronaves</th><th class="num">Trechos</th><th class="num">No RPL</th><th class="num">Baixado</th><th class="num">Tempo</th><th></th></tr></thead><tbody>
          ${s.days.map((d) => html`<tr><td>${fmtDate(d.day, { weekday: true })}</td><td class="num">${d.aircraft}</td><td class="num">${d.runs}</td><td class="num">${d.matched ?? '—'}</td><td class="num">${Math.round(d.mb)} MB</td><td class="num">${fmtDur(Math.round(d.seconds / 60))}</td>
            <td class="num"><button class="icon-btn" type="button" data-del="${d.day}" title="Apagar este dia">${icon('trash')}</button></td></tr>`)}
        </tbody></table></div></section>

      <section class="panel" style="margin-top:18px" id="ad-stats"><div class="skeleton"></div></section>

      <section class="panel" style="margin-top:18px">
        <div class="panel-head"><h2>Matrículas vistas</h2>
          <select class="input" id="ad-al" style="width:auto"><option value="">Todas</option>${s.airlines.map((a) => html`<option value="${a.airline}" ${filter.airline === a.airline ? 'selected' : ''}>${a.airline}</option>`)}</select>
          <select class="input" id="ad-fl" style="width:auto"><option value="">Todas</option><option value="fora" ${filter.fleet === 'fora' ? 'selected' : ''}>Só fora da frota</option></select>
          <input class="input" id="ad-q" placeholder="Matrícula, tipo, voo…" value="${filter.q}" style="max-width:220px">
          <button class="btn sm" type="button" id="ad-csv">${icon('download')}Exportar CSV</button></div>
        <div id="ad-list"><div class="skeleton"></div></div></section>`);
    drawList();
    drawStats();
  }

  async function drawList() {
    const q = new URLSearchParams(filter);
    const r = await api('/adsb/aircraft?' + q);
    mount($('#ad-list', el), r.items.length ? html`<div class="table-wrap" style="max-height:520px"><table class="tbl"><thead><tr><th>Matrícula</th><th>Cia</th><th>Tipo</th><th>Hex</th><th class="num">Dias vista</th><th>Último voo</th><th class="num">Pernas</th><th>Frota</th></tr></thead><tbody>
      ${r.items.map((a) => html`<tr class="clickable" data-hex="${a.hex}"><td class="strong">${a.registration || html`<span class="muted">sem matrícula</span>`}</td><td>${airlineTag(a.airline)}</td><td>${a.icao_type || '—'}</td><td class="mono small">${a.hex}</td>
        <td class="num">${a.days}</td><td>${a.last_callsign || ''}</td><td class="num">${a.legs}</td>
        <td>${a.fleet_id ? html`<span class="badge ok">na frota${a.fleet_type ? '' : ' · sem modelo'}</span>` : a.suspect ? html`<span class="badge warn" title="${a.suspect}">conferir</span> <button class="btn sm ghost" type="button" data-one="${a.hex}" title="Adicionar mesmo assim">${icon('plus')}</button>` : html`<span class="badge">nova</span>`}</td></tr>`)}
    </tbody></table></div><p class="hint" style="margin-top:6px">${r.items.length} aeronave(s). Clique para ver as pernas observadas.</p>` : html`<p class="muted">Nada encontrado.</p>`);
  }

  async function drawStats() {
    let st;
    try { st = await api('/adsb/stats'); } catch (er) { mount($('#ad-stats', el), html`<div class="notice warn">${icon('alert')}<div>${er.message}</div></div>`); return; }
    const als = Object.keys(st.real);
    const totalRepeat = (() => { let n = 0, d = 0; als.forEach((a) => { const r = st.real[a]; if (r.repeat_day_pct != null) { n += r.repeat_day_pct * r.aircraft_days; d += r.aircraft_days; } }); return d ? Math.round(n / d) : null; })();
    const m = st.model;
    mount($('#ad-stats', el), html`
      <div class="panel-head"><h2>Lógica operacional real</h2><span class="muted small">medida nas pernas ligadas ao RPL (horários do RPL)</span></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Cia</th><th class="num">Aeronaves</th><th class="num">Pernas/dia (média · P10–P90)</th><th class="num">Solo P10 · mediana · P90</th><th class="num">Dias com vai-e-volta repetido</th><th>Pares mais repetidos</th><th>Pernoites mais comuns</th></tr></thead><tbody>
        ${als.map((a) => { const r = st.real[a]; return html`<tr><td>${airlineTag(a)}</td><td class="num">${r.aircraft}</td>
          <td class="num">${r.legs_per_day.media ?? '—'} · ${r.legs_per_day.p10 ?? '—'}–${r.legs_per_day.p90 ?? '—'}</td>
          <td class="num">${r.turn_min.p10 ?? '—'} · ${r.turn_min.p50 ?? '—'} · ${r.turn_min.p90 ?? '—'} min</td>
          <td class="num">${r.repeat_day_pct != null ? `${r.repeat_day_pct}%` : '—'}</td>
          <td class="small">${r.repeat_pairs.map(([p, n]) => `${p} (${n})`).join(', ') || '—'}</td>
          <td class="small">${r.overnight_top.map(([p, n]) => `${p} (${n})`).join(', ') || '—'}</td></tr>`; })}
      </tbody></table></div>
      ${totalRepeat != null ? html`<div class="notice info" style="margin-top:10px">${icon('info')}<div>Na operação real, <b>${totalRepeat}%</b> dos dias de cada aeronave têm 3+ pernas no mesmo par de aeroportos (ponte aérea, bate-voltas seguidos). No gerador isso está como anormalidade com chance de <b>${state.meta.settings.anomaly_repeat_pct ?? 5}%</b>.
        <button class="btn sm" type="button" id="ad-anom" data-v="${totalRepeat}" style="margin-left:8px">Usar ${totalRepeat}% (realista)</button></div></div>` : ''}

      <h3 style="margin:18px 0 8px">Modelo de rodízio nos dados reais</h3>
      <p class="text-2">${st.transitions} transição(ões) observadas (perna → próxima perna da mesma matrícula). ${st.weights_info ? html`Pesos calibrados em uso desde ${st.weights_info.at.slice(0, 16).replace('T', ' ')} (${(st.weights_info.airlines || []).join(', ')}).` : 'Pesos padrão em uso.'}</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Cia</th><th class="num">Transições</th><th class="num">Próxima perna em 1º</th><th class="num">Entre as 3 primeiras</th><th class="num">Fora dos candidatos</th></tr></thead><tbody>
        ${Object.entries(m).map(([a, v]) => html`<tr><td>${a === '_total' ? html`<b>Total</b>` : airlineTag(a)}</td><td class="num">${v.n}</td><td class="num">${pct(v.top1)}</td><td class="num">${pct(v.top3)}</td><td class="num">${v.fora}</td></tr>`)}
      </tbody></table></div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" type="button" id="ad-cal" ${st.transitions < 50 ? 'disabled' : ''}>${icon('chart')}Calibrar com os dados reais</button>
        ${st.weights_info ? html`<button class="btn ghost" type="button" id="ad-reset">${icon('refresh')}Voltar aos pesos padrão</button>` : ''}
      </div>
      <div id="ad-cal-res"></div>`);
  }

  function calHTML(r) {
    const rowsCmp = Object.keys(r.after).map((a) => html`<tr><td>${a === '_total' ? html`<b>Total</b>` : airlineTag(a)}</td><td class="num">${r.after[a].n}</td>
      <td class="num">${pct(r.before[a]?.top1)} → <b>${pct(r.after[a].top1)}</b></td><td class="num">${pct(r.before[a]?.top3)} → <b>${pct(r.after[a].top3)}</b></td>
      <td class="num">${r.before[a]?.loglik} → <b>${r.after[a].loglik}</b></td></tr>`);
    const als = Object.keys(r.weights);
    return html`<section style="margin-top:14px"><div class="notice info">${icon('info')}<div>Calibração com ${r.transitions} transições: ${r.split}. A comparação abaixo usa só os dados de validação, que o ajuste não viu.</div></div>
      <div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Cia</th><th class="num">Validação</th><th class="num">1º lugar</th><th class="num">Top 3</th><th class="num">Log-verossimilhança (maior = melhor)</th></tr></thead><tbody>${rowsCmp}</tbody></table></div>
      <div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Característica</th>${als.map((a) => html`<th class="num">${a}</th>`)}<th class="num">Padrão (antes)</th></tr></thead><tbody>
        ${Object.keys(FEATS).map((k) => html`<tr><td>${FEATS[k]}</td>${als.map((a) => html`<td class="num">${r.weights[a][k]}</td>`)}<td class="num muted">${r.default[k]}</td></tr>`)}
      </tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="ad-apply">${icon('check')}Aplicar estes pesos</button>
      <span class="hint">O gerador, o briefing e as previsões passam a usar os pesos de cada companhia. Dá para voltar aos padrão a qualquer momento.</span></div></section>`;
  }

  let lastCal = null;
  el.onclick = async (e) => {
    const t = e.target.closest('button, tr[data-hex]');  // botão dentro da linha tem prioridade
    if (!t) return;
    if (t.dataset.fleet) {
      withBusy(t, async () => {
        try {
          const r = await api('/adsb/to-fleet', { method: 'POST', body: { airline: t.dataset.fleet } });
          toast(`${r.created} aeronave(s) adicionada(s) à frota${r.models_filled ? `, ${r.models_filled} modelo(s) completado(s)` : ''}.`);
          if (r.suspects.length) toast(`Ficaram de fora para conferir (tipo não combina com o RPL da companhia): ${r.suspects.join(', ')}. Dá para adicionar uma a uma na lista.`, 'warn', 12000);
          if (r.errors.length) toast(r.errors.join('; '), 'warn', 9000);
          await refreshMeta(); load();
        } catch (er) { toastError(er); }
      });
    } else if (t.dataset.one) {
      e.stopPropagation();
      try { const r = await api('/adsb/to-fleet', { method: 'POST', body: { hexes: [t.dataset.one] } }); toast(r.created ? 'Aeronave adicionada à frota.' : (r.errors[0] || 'Nada a adicionar.')); await refreshMeta(); load(); } catch (er) { toastError(er); }
    } else if (t.dataset.del) {
      if (!(await confirmDialog(`Apagar os dados ADS-B de ${dm(t.dataset.del)}?`, { ok: 'Apagar', danger: true }))) return;
      try { await api(`/adsb/days/${t.dataset.del}`, { method: 'DELETE' }); load(); } catch (er) { toastError(er); }
    } else if (t.id === 'ad-csv') {
      download(`/api/adsb/aircraft.csv${filter.airline ? `?airline=${filter.airline}` : ''}`);
    } else if (t.id === 'ad-rematch') {
      withBusy(t, async () => { try { const r = await api('/adsb/rematch', { method: 'POST' }); toast(`${r.rpl || 0} trecho(s) ligados ao RPL, ${r.posicao || 0} por posição.`); load(); } catch (er) { toastError(er); } });
    } else if (t.id === 'ad-anom') {
      try { await api('/settings', { method: 'PUT', body: { anomaly_repeat_pct: +t.dataset.v } }); await refreshMeta(); toast(`Chance de anormalidade agora é ${t.dataset.v}%.`); drawStats(); } catch (er) { toastError(er); }
    } else if (t.id === 'ad-cal') {
      withBusy(t, async () => { try { lastCal = await api('/adsb/calibrate', { method: 'POST' }); mount($('#ad-cal-res', el), calHTML(lastCal)); } catch (er) { toastError(er); } });
    } else if (t.id === 'ad-apply' && lastCal) {
      try { await api('/adsb/weights', { method: 'POST', body: { weights: lastCal.weights, transitions: lastCal.transitions } }); toast('Pesos calibrados aplicados.'); lastCal = null; drawStats(); } catch (er) { toastError(er); }
    } else if (t.id === 'ad-reset') {
      try { await api('/adsb/weights', { method: 'POST', body: { weights: {} } }); toast('Pesos padrão restaurados.'); drawStats(); } catch (er) { toastError(er); }
    } else if (t.dataset.hex) {
      showAircraft(t.dataset.hex);
    }
  };
  el.onchange = (e) => {
    if (e.target.id === 'ad-al') { filter.airline = e.target.value; drawList(); }
    if (e.target.id === 'ad-fl') { filter.fleet = e.target.value; drawList(); }
  };
  let qt = null;
  el.oninput = (e) => { if (e.target.id === 'ad-q') { clearTimeout(qt); qt = setTimeout(() => { filter.q = e.target.value.trim(); drawList(); }, 300); } };

  async function showAircraft(hx) {
    const r = await api(`/adsb/aircraft/${hx}/legs`);
    const a = r.aircraft;
    const days = new Map();
    r.legs.forEach((l) => { const d = (l.dep_local || l.dep_utc || '').slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(l); });
    openModal({
      title: `${a.registration || 'sem matrícula'} · ${a.icao_type || '?'} · ${a.airline}`, wide: true,
      body: html`<p class="text-2">Hex ${a.hex} · vista em ${a.days} dia(s) (${dm(a.first_day)} a ${dm(a.last_day)}). Horários do RPL quando o voo foi ligado ao RPL; senão, horários em que o ADS-B viu a aeronave.</p>
        ${[...days].map(([d, ls]) => html`<h3 style="margin:14px 0 6px">${fmtDate(d, { weekday: true })}</h3>
          ${ls.map((l) => html`${l.gap_before ? html`<div class="turn ${l.gap_before.kind === 'lacuna_dados' ? 'break' : ''}">${l.gap_before.label} · ${fmtDur(l.gap_before.minutes)}</div>` : ''}
            <div class="mini-leg" data-origin="${l.source === 'rpl' ? 'REAL' : 'MANUAL'}"><span class="bar"></span><span class="when"><b>${hm(l.dep_local)}</b>${hm(l.arr_local) ? `–${hm(l.arr_local)}` : ''}</span>
              <span><b>${l.callsign}</b> ${l.adep || '?'} → ${l.ades || '?'}</span>
              <span class="badge ${l.source === 'rpl' ? 'real' : ''}">${l.source === 'rpl' ? 'voo do RPL' : 'por posição'}</span></div>`)}`)}`,
    });
  }

  await load();
  poll();
  return () => { clearTimeout(timer); el.onclick = null; el.onchange = null; el.oninput = null; };
}
