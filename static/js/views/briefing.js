import { api, html, mount, icon, state, $, toastError, toast, withBusy, fmtDate, fmtDur, originBadge, airlineTag, download, legTime } from '../core.js';
import { metarCard, tafBlock } from '../wx.js';
import { webeyeUrl, openWebeye } from '../ivao.js';

const CONF = { alta: 'ok', 'média': 'warn', baixa: 'err' };
const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const hm = (s) => (s || '').slice(11, 16);

export async function render(el, parts) {
  if (parts[0] === 'escala') return renderDay(el, +parts[1]);
  return renderLeg(el, +parts[0]);
}

function autoTimer(fn) {
  const n = +(state.meta.settings.metar_autorefresh_min || 0);
  return n ? setInterval(fn, n * 60000) : null;
}

async function renderLeg(el, lid) {
  let b;
  const load = async (force = false) => { b = await api(`/legs/${lid}/briefing${force ? '?force=1' : ''}`); draw(); };
  const draw = () => {
    const l = b.leg, ac = b.aircraft, o = b.airports.origin, d = b.airports.destination;
    const dp = legTime(l, 'dep'), ar = legTime(l, 'arr');
    mount(el, html`
      <div class="page-head brief-head">
        <div>
          <div class="row muted small" style="margin-bottom:6px"><a href="#/escalas/${b.schedule.id}">${b.schedule.name}</a><span>/</span><span>perna ${b.position.index} de ${b.position.total}</span>${airlineTag(b.schedule.airline)}${originBadge(l.data_origin)}${l.activity === 'RESERVA' ? html`<span class="badge res" title="Voo do RPL atribuído pelo sorteio de acionamento da reserva">Acionamento de reserva (simulado)</span>` : ''}</div>
          <h1>Briefing · ${l.flight_number || 'Posicionamento'} ${l.adep} → ${l.ades}</h1>
          <p class="lead">${fmtDate(l.local_date, { weekday: true })} · gerado às ${hm(b.generated_at)}Z</p>
        </div>
        <div class="actions no-print">
          ${b.prev ? html`<a class="btn" href="#/briefing/${b.prev.id}">${icon('left')}Anterior</a>` : ''}
          ${b.next ? html`<a class="btn" href="#/briefing/${b.next.id}">Próxima${icon('right')}</a>` : ''}
          <button class="btn" data-a="wx">${icon('refresh')}Atualizar METAR</button>
          <button class="btn" data-a="webeye">${icon('radar')}Webeye</button>
          ${b.simbrief?.url ? html`<a class="btn" href="${b.simbrief.url}" target="_blank" rel="noopener" data-sb-main>${icon('send')}SimBrief</a>` : ''}
          <button class="btn" data-a="html">${icon('download')}Baixar HTML</button>
          <button class="btn primary" data-a="print">${icon('printer')}Imprimir / PDF</button>
        </div>
      </div>
      ${b.alerts.length ? html`<div class="stack" style="gap:6px;margin-bottom:16px">${b.alerts.map((a) => html`<div class="notice ${a.level === 'error' ? 'err' : a.level === 'warning' ? 'warn' : 'info'}">${icon(a.level === 'info' ? 'info' : 'alert')}<div>${a.text}</div></div>`)}</div>` : ''}
      <section class="brief-board panel">
        <div class="bb-ap"><span class="muted small">Partida</span><span class="bb-code">${l.adep}</span><span>${o.name || ''}</span><span class="muted">${o.city || 'aeroporto não cadastrado'}${o.iata ? ` · ${o.iata}` : ''}</span>
          <span class="bb-time">${dp.t}<small>${dp.z === 'L' ? l.dep_off : 'UTC'}</small></span><span class="muted small">${dp.alt}</span></div>
        <div class="bb-mid"><span>${icon('plane')}</span><b>${fmtDur(l.block_min)}</b><span class="muted small">bloco estimado · EET ${fmtDur(l.eet_min)}</span></div>
        <div class="bb-ap r"><span class="muted small">Chegada</span><span class="bb-code">${l.ades}</span><span>${d.name || ''}</span><span class="muted">${d.city || 'aeroporto não cadastrado'}${d.iata ? ` · ${d.iata}` : ''}</span>
          <span class="bb-time">${ar.t}<small>${ar.z === 'L' ? l.arr_off : 'UTC'}</small></span><span class="muted small">${ar.alt}</span></div>
        <div class="bb-ac"><span class="muted small">Aeronave</span><b class="bb-reg">${l.registration || 'sem matrícula'}</b>
          <span>${ac?.model || l.type_icao || '—'}${ac?.is_demo ? html` <span class="badge demo">FICTÍCIA</span>` : ''}</span>
          <span class="muted small">RPL prevê ${l.planned_type || '—'}</span>
          ${ac?.config?.length ? html`<div class="row" style="gap:4px;margin-top:6px">${ac.config.map((c) => html`<span class="badge ${c.value === 'SIM' ? 'ok' : c.value === 'NÃO' ? '' : 'warn'}">${c.label}: ${c.value}</span>`)}</div>` : ''}</div>
      </section>

      <h2 class="brief-h">Meteorologia</h2>
      <div class="grid grid-2">${metarCard(b.weather.metar.origin, { title: `Origem · ${o.city || ''}`, taf: b.weather.taf.origin })}${metarCard(b.weather.metar.destination, { title: `Destino · ${d.city || ''}`, taf: b.weather.taf.destination })}</div>
      ${b.weather.comparison.length ? html`<div class="strip-checks" style="margin:10px 0 0">${b.weather.comparison.map((c) => html`<div class="${c.level}">${icon(c.level === 'info' ? 'info' : 'alert')}${c.text}</div>`)}</div>` : ''}

      ${planHTML(b)}

      <div class="grid grid-2" style="margin-top:18px">
        <section class="panel"><h2 class="brief-h" style="margin-top:0">Sequência da aeronave</h2>
          <div class="seq">
            ${b.prev ? seqRow('Anterior', b.prev, b.prev.gap_next, b.prev.model_next, 'Esta perna é a continuação') : html`<div class="muted small">Primeira perna da escala.</div>`}
            ${seqRow('Este voo', l, null, null, '', true)}
            ${l.gap_next ? html`<div class="seq-gap">${l.gap_next.label} · ${fmtDur(l.gap_next.minutes)}</div>` : ''}
            ${b.next ? seqRow('Próxima na escala', b.next, null, l.model_next, '', false, true) : html`<div class="muted small">Última perna da escala.</div>`}
          </div></section>
        <section class="panel"><h2 class="brief-h" style="margin-top:0">Plano repetitivo (RPL)</h2>
          ${b.rpl ? html`<dl class="kv"><dt>Rota</dt><dd><code>${b.rpl.route}</code></dd><dt>Nível / velocidade</dt><dd>FL${b.rpl.fl} · ${b.rpl.speed}</dd>
            <dt>EOBT / EET</dt><dd>${b.rpl.eobt}Z · ${b.rpl.eet}</dd>${Object.entries(b.rpl.remarks).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
            <dt>Origem do dado</dt><dd class="small muted">${b.rpl.file}, linha ${b.rpl.line} · válido ${b.rpl.valid}</dd></dl>`
          : html`<p class="muted">Perna sem voo do RPL (${l.origin_label}).</p>`}
          ${b.duty ? html`<h3 style="margin:14px 0 6px">Jornada do dia</h3><p class="text-2">Apresentação ${b.duty.report_local} · fim ${b.duty.release_local} · ${b.duty.legs} pouso(s) · jornada ${fmtDur(Math.round(b.duty.duty_h * 60))} de ${b.duty.fdp_limit_h} h · voo ${fmtDur(Math.round(b.duty.block_h * 60))} de ${b.duty.flight_limit_h} h</p><p class="hint">${b.crew_mode}</p>` : ''}
        </section>
      </div>

      <section class="panel" style="margin-top:18px">
        <div class="panel-head"><h2>Próxima perna prevista pelo modelo</h2><span class="badge sugg">previsão – não confirmada</span><span class="muted small">${b.prediction.n} voo(s) do RPL partem de ${l.ades} nas 22 h seguintes</span></div>
        ${b.prediction.candidates.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Voo</th><th>Trecho</th><th>Partida</th><th>Intervalo</th><th>Probabilidade</th><th>Confiança</th><th>Por quê</th></tr></thead><tbody>
          ${b.prediction.candidates.map((c) => html`<tr><td class="strong">${c.ident}${b.next && b.next.flight_number === c.ident ? html` <span class="badge orange">na escala</span>` : ''}</td><td>${c.adep} → ${c.ades}</td><td>${c.dep_local.slice(8, 10)}/${c.dep_local.slice(5, 7)} ${hm(c.dep_local)}</td>
            <td class="small">${c.gap_label}<br><span class="muted">${fmtDur(c.ground_min)}</span></td>
            <td><div class="row" style="gap:8px;flex-wrap:nowrap"><span class="duty-bar"><i style="width:${Math.round(c.p * 100)}%;background:var(--sugg)"></i></span>${pct(c.p)}</div></td>
            <td><span class="badge ${CONF[c.confidence]}" title="${c.confidence_note}">${c.confidence}</span></td>
            <td class="small text-2">${c.reasons.filter((r) => r.weight !== 0).map((r) => html`<div>${r.weight > 0 ? '+' : '−'} ${r.text}</div>`)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nenhum voo compatível sai de ${l.ades} nas 22 h seguintes: pernoite prolongado ou falta de dados.</p>`}
        <p class="hint" style="margin-top:8px">${b.prediction.note} Pesos calibrados com amostras observadas de GOL, Azul e LATAM; veja a qualidade do modelo em <a href="#/previsoes">Previsões</a>.</p>
      </section>`);
  };
  function planHTML(b) {
    const sb = b.simbrief;
    if (!sb) return '';
    const q = sb.params, alt = sb.alternate, l = b.leg;
    const altAp = b.airports.alternate;
    const cs = l.flight_number || '';
    return html`<section class="panel" style="margin-top:18px">
      <div class="panel-head"><h2>Planejamento: SimBrief e IVAO</h2><span class="muted small">campos montados a partir do RPL e da aeronave</span></div>
      <div class="grid grid-2">
        <div>
          <dl class="kv sb-kv">
            <dt>Voo</dt><dd><b>${q.airline}${q.fltnum || ''}</b> · ${q.type || '—'}${q.reg ? ` · ${q.reg}` : ''}</dd>
            <dt>Trecho</dt><dd>${q.orig} → ${q.dest}</dd>
            <dt>Data / partida</dt><dd>${q.date} · ${q.deph}:${q.depm}Z${q.steh ? ` · EET ${q.steh}h${q.stem}` : ''}</dd>
            <dt>Observações</dt><dd><code>${q.extrarmk}</code></dd>
          </dl>
          <form id="sb-form" class="form-grid" style="margin-top:12px">
            <label class="field">Alternado<input class="input" name="altn" value="${q.altn || ''}" placeholder="SimBrief escolhe" maxlength="4" style="text-transform:uppercase"><span class="hint">${alt.note}</span></label>
            <label class="field">Nível (FL)<input class="input" name="fl" value="${q.fl ? q.fl / 100 : ''}" placeholder="350" maxlength="5"><span class="hint">RPL: ${b.rpl ? `FL${b.rpl.fl}` : '—'}</span></label>
            <label class="field" style="grid-column:1/-1">Rota<textarea class="input mono" name="route" rows="2" style="text-transform:uppercase">${q.route || ''}</textarea></label>
          </form>
          ${sb.notes.length ? html`<div class="strip-checks" style="margin:8px 0 0">${sb.notes.map((n) => html`<div class="info">${icon('info')}${n}</div>`)}</div>` : ''}
          <div class="row" style="margin-top:12px">
            <a class="btn primary" id="sb-open" href="${sb.url}" target="_blank" rel="noopener">${icon('send')}Abrir no SimBrief</a>
            <button class="btn" type="button" data-a="sb-copy">${icon('link')}Copiar link</button>
          </div>
          <p class="hint" style="margin-top:6px">Abre o despacho do SimBrief já preenchido (é preciso estar logado no Navigraph/SimBrief). Mudou alternado, nível ou rota? O link é refeito sozinho.</p>
        </div>
        <div>
          ${altAp ? metarCard(b.weather.metar.alternate, { title: `Alternado · ${altAp.city || ''}`, taf: b.weather.taf.alternate || null, compact: true }) : html`<div class="muted small">Sem alternado definido: o SimBrief escolhe.</div>`}
          <h3 style="margin:14px 0 6px">IVAO Webeye</h3>
          <div class="row">
            <button class="btn sm" type="button" data-we="${webeyeUrl({ icao: l.adep })}">${icon('radar')}${l.adep}</button>
            <button class="btn sm" type="button" data-we="${webeyeUrl({ icao: l.ades })}">${icon('radar')}${l.ades}</button>
            ${cs ? html`<button class="btn sm" type="button" data-we="${webeyeUrl({ callsign: cs })}">${icon('eye')}Seguir ${cs}</button>` : ''}
            <a class="btn sm ghost" href="#/webeye?icao=${l.adep}">${icon('external')}Abrir na página</a>
          </div>
          <p class="hint" style="margin-top:6px">Abre o mapa ao vivo da IVAO numa janela separada, centralizado no aeroporto ou seguindo o indicativo (só aparece se o voo estiver conectado na rede).</p>
        </div>
      </div></section>`;
  }
  let sbTimer = null;
  el.oninput = (e) => {
    if (!e.target.closest('#sb-form')) return;
    clearTimeout(sbTimer);
    sbTimer = setTimeout(async () => {
      const f = $('#sb-form', el);
      const q = new URLSearchParams({ altn: f.altn.value.trim(), fl: f.fl.value.trim(), route: f.route.value });
      try {
        const r = await api(`/legs/${lid}/simbrief?${q}`);
        $('#sb-open', el).href = r.url;
        const top = el.querySelector('[data-sb-main]'); if (top) top.href = r.url;
        b.simbrief.url = r.url;
        f.querySelectorAll('.input').forEach((i) => i.classList.remove('invalid'));
      } catch (er) { f.querySelectorAll('.input').forEach((i) => i.classList.add('invalid')); }
    }, 350);
  };
  function seqRow(lbl, x, gap, model, _t, current = false, isNext = false) {
    return html`<div class="seq-row ${current ? 'cur' : ''}"><span class="muted small">${lbl}</span>
      <a href="#/briefing/${x.id}" class="strong">${x.flight_number || 'POS'}</a><span>${x.adep} → ${x.ades}</span><span>${hm(x.dep_local)} – ${hm(x.arr_local)}</span>
      ${isNext && model ? html`<span class="badge ${model.rank === 1 ? 'ok' : 'warn'}" title="Probabilidade do modelo de esta ser a continuação">modelo ${pct(model.p)} · ${model.rank ? `${model.rank}º de ${model.n}` : 'fora dos candidatos'}</span>` : html`<span></span>`}</div>
      ${gap ? html`<div class="seq-gap">${gap.label} · ${fmtDur(gap.minutes)}${model && model.p != null ? ` · modelo ${pct(model.p)}` : ''}</div>` : ''}`;
  }
  el.onclick = async (e) => {
    const w = e.target.closest('[data-we]'); if (w) { openWebeye(w.dataset.we); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'print') window.print();
    if (a.dataset.a === 'html') download(`/api/legs/${lid}/briefing.html`);
    if (a.dataset.a === 'wx') withBusy(a, () => load(true).catch(toastError));
    if (a.dataset.a === 'webeye') openWebeye(webeyeUrl({ icao: b.leg.adep }));
    if (a.dataset.a === 'sb-copy') {
      try { await navigator.clipboard.writeText(b.simbrief.url); toast('Link do SimBrief copiado.'); } catch { toast('Não foi possível copiar automaticamente; use "Abrir no SimBrief".', 'warn'); }
    }
  };
  await load(false);
  // atualização automática do METAR sem perder o que foi digitado no formulário do SimBrief
  const t = autoTimer(() => { if (!el.querySelector('#sb-form:focus-within')) load(false).catch(() => {}); });
  return () => { el.onclick = null; el.oninput = null; if (t) clearInterval(t); };
}

async function renderDay(el, sid) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let day = params.get('data') || '';
  let b;
  const load = async (force = false) => { b = await api(`/schedules/${sid}/briefing?${day ? `date=${day}&` : ''}${force ? 'force=1' : ''}`); day = b.day; draw(); };
  const draw = () => {
    const apmap = Object.fromEntries(b.airports.map((a) => [a.icao, a]));
    mount(el, html`
      <div class="page-head brief-head">
        <div><div class="row muted small" style="margin-bottom:6px"><a href="#/escalas/${sid}">${b.schedule.name}</a>${airlineTag(b.schedule.airline)}</div>
          <h1>Briefing do dia · ${fmtDate(b.day, { weekday: true })}</h1><p class="lead">${b.aircraft?.registration || 'sem matrícula'}${b.aircraft?.model ? ` · ${b.aircraft.model}` : ''} · ${b.legs.length} perna(s) · gerado às ${hm(b.generated_at)}Z</p></div>
        <div class="actions no-print">
          <select class="input" id="bd-day" style="width:auto">${b.dates.map((d) => html`<option value="${d}" ${d === b.day ? 'selected' : ''}>${fmtDate(d, { weekday: true })}</option>`)}</select>
          <button class="btn" data-a="wx">${icon('refresh')}Atualizar METAR</button>
          <button class="btn" data-a="html">${icon('download')}Baixar HTML</button>
          <button class="btn primary" data-a="print">${icon('printer')}Imprimir / PDF</button>
        </div>
      </div>
      <section class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>Voo</th><th>Trecho</th><th>Partida</th><th>Chegada</th><th>Bloco</th><th>Dado</th><th>Cat. origem → destino</th><th>Intervalo seguinte</th><th class="no-print"></th></tr></thead><tbody>
        ${b.legs.map((l) => { const mo = b.weather.metar[l.adep]?.metar, md = b.weather.metar[l.ades]?.metar; return html`<tr>
          <td class="strong">${l.flight_number || 'POS'}</td><td>${l.adep} → ${l.ades}</td><td>${legTime(l, 'dep').t} ${legTime(l, 'dep').z}</td><td>${legTime(l, 'arr').t} ${legTime(l, 'arr').z}</td><td>${fmtDur(l.block_min)}</td><td>${originBadge(l.data_origin)}</td>
          <td>${catBadge(mo)} → ${catBadge(md)}</td>
          <td class="small">${l.gap_next ? html`${l.gap_next.label} · ${fmtDur(l.gap_next.minutes)}${l.model_next?.p != null ? html`<br><span class="muted">modelo ${pct(l.model_next.p)}</span>` : ''}` : '—'}</td>
          <td class="no-print"><div class="row" style="gap:6px;flex-wrap:nowrap"><a class="btn sm" href="#/briefing/${l.id}">${icon('clipboard')}Briefing</a>${l.simbrief?.url ? html`<a class="btn sm" href="${l.simbrief.url}" target="_blank" rel="noopener" title="Alternado ${l.simbrief.altn || 'automático'}">${icon('send')}SimBrief</a>` : ''}</div></td></tr>`; })}
      </tbody></table></div>
      ${b.duty.map((d) => html`<p class="text-2" style="margin-top:10px">Jornada: apresentação ${d.report_local}, fim ${d.release_local}, ${fmtDur(Math.round(d.duty_h * 60))} de ${d.fdp_limit_h} h, ${d.legs} pouso(s)${d.madrugada ? ', madrugada' : ''}.</p>`)}
      </section>
      <h2 class="brief-h">Meteorologia dos aeroportos do dia</h2>
      <div class="wx-list">${b.airports.map((a) => metarCard(b.weather.metar[a.icao], { title: a.city || '', taf: b.weather.taf[a.icao] || null, compact: true }))}</div>
      ${b.continuation.length ? html`<section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Continuação prevista após a escala</h2><span class="badge sugg">previsão – não confirmada</span></div>
        ${b.continuation.map((c) => html`<div class="mini-leg" data-origin="SUGESTAO"><span class="bar"></span><span class="when"><b>${hm(c.dep_local)}</b>${c.dep_local.slice(8, 10)}/${c.dep_local.slice(5, 7)}</span><span><b>${c.ident}</b> ${c.adep} → ${c.ades}<br><small class="muted">${c.gap_label} · ${c.reasons.filter((r) => r.weight > 0).map((r) => r.text).join('; ')}</small></span><span class="badge ${CONF[c.confidence]}">${pct(c.p)} · ${c.confidence}</span></div>`)}</section>` : ''}`);
  };
  const catBadge = (m) => (m?.flight_category ? html`<span class="badge ${{ VFR: 'real', MVFR: 'proj', IFR: 'err', LIFR: 'sugg' }[m.flight_category]}">${m.flight_category}</span>` : html`<span class="muted small">—</span>`);
  el.onclick = async (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'print') window.print();
    if (a.dataset.a === 'html') download(`/api/schedules/${sid}/briefing.html?date=${day}`);
    if (a.dataset.a === 'wx') withBusy(a, () => load(true).catch(toastError));
  };
  el.onchange = (e) => { if (e.target.id === 'bd-day') { day = e.target.value; load(false).catch(toastError); } };
  await load(false);
  const t = autoTimer(() => load(false).catch(() => {}));
  return () => { el.onclick = null; el.onchange = null; if (t) clearInterval(t); };
}
