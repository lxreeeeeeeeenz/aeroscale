import { api, html, mount, icon, state, legTime, fmtDur, fmtDate, airlineTag, originBadge, isoDate, ORIGIN, $, toastError, refreshMeta, withBusy, toast, legend } from '../core.js';
import { calendarHTML, calendarTitle, bindCalendar, showLegModal } from '../legs.js';

function countdown(depUtc) {
  const ms = new Date(depUtc) - new Date();
  if (ms <= 0) return 'em andamento';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `em ${d}d ${h}h` : h ? `em ${h}h${String(mm).padStart(2, '0')}` : `em ${mm} min`;
}

export async function render(el) {
  const data = await api('/dashboard');
  const m = state.meta;
  const hasRpl = m.airlines.some((a) => a.coverage);
  const next = data.upcoming[0];
  const anchor = isoDate(new Date());
  const weekLegs = (await api(`/calendar?from=${isoDate(new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 864e5))}&to=${isoDate(new Date(Date.now() + 7 * 864e5))}`)).legs;
  const fl = data.stats.flights;
  const totalFlights = fl.reduce((s, x) => s + x.n, 0);
  const totalAc = data.stats.aircraft.reduce((s, x) => s + x.n, 0);
  const demoAc = data.stats.aircraft.reduce((s, x) => s + (x.demo || 0), 0);

  mount(el, html`
    <div class="page-head">
      <div><h1>Painel de despacho</h1><p class="lead">Escalas geradas a partir dos planos de voo repetitivos (CGNA/RPL) e da frota cadastrada.</p></div>
      <div class="actions"><a class="btn primary" href="#/gerador">${icon('wand')}Gerar escala</a></div>
    </div>
    ${!hasRpl ? html`<div class="panel" style="margin-bottom:18px"><div class="empty">
      ${icon('inbox')}<h3>Comece importando os arquivos RPL</h3>
      <p>Sem RPL não há voos reais para montar escalas. Os arquivos de AZU, GOL e LATAM (validade 22/10/2026) já vêm na pasta de exemplos.</p>
      <div class="row"><button class="btn primary" id="imp-samples">${icon('download')}Importar arquivos da pasta rpl/</button><a class="btn" href="#/importacoes">Importar outro arquivo</a></div>
    </div></div>` : ''}
    <div class="grid grid-dash">
      <div class="stack" style="gap:18px">
        <section class="panel next-flight">
          ${next ? html`
            <div class="eyebrow">${icon('takeoff')}<span>Próximo voo</span><span class="countdown">${countdown(next.dep_utc)}</span><span class="spacer"></span>${originBadge(next.data_origin)}</div>
            <div class="board">
              <div class="big">${next.adep}<small>${next.adep_city || ''} · ${legTime(next, 'dep').t} ${legTime(next, 'dep').z}</small></div>
              <div class="arc">${icon('plane')}</div>
              <div class="big" style="text-align:right">${next.ades}<small>${next.ades_city || ''} · ${legTime(next, 'arr').t} ${legTime(next, 'arr').z}</small></div>
            </div>
            <div class="facts">
              <div>Voo<b>${next.flight_number || 'POS'}</b></div>
              <div>Data<b>${fmtDate(next.local_date, { weekday: true })}</b></div>
              <div>Matrícula<b>${next.registration || '—'}</b></div>
              <div>Aeronave<b>${next.type_icao || '—'}</b></div>
              <div>Bloco<b>${fmtDur(next.block_min)}</b></div>
              <div>Escala<b><a href="#/escalas/${next.schedule_id}">${next.schedule_name}</a></b></div>
            </div>` : html`
            <div class="eyebrow">${icon('takeoff')}<span>Próximo voo</span></div>
            <div class="empty" style="margin-top:14px"><h3>Nenhum voo futuro escalado</h3><p>Gere uma escala semanal ou mensal para ver aqui o próximo voo.</p><a class="btn primary" href="#/gerador">${icon('wand')}Gerar escala</a></div>`}
        </section>
        <div class="stat-line">
          <div><div class="v">${totalFlights.toLocaleString('pt-BR')}</div><div class="l">registros RPL ativos (${fl.map((f) => f.airline).join(', ') || 'nenhum'})</div></div>
          <div><div class="v">${totalAc}</div><div class="l">aeronaves ativas${demoAc ? ` · ${demoAc} fictícias` : ''}</div></div>
          <div><div class="v">${data.stats.schedules}</div><div class="l">escalas · ${data.stats.legs} pernas</div></div>
          <div><div class="v" style="color:${data.stats.open_flags ? 'var(--warn)' : 'inherit'}">${data.stats.open_flags}</div><div class="l"><a href="#/frota?tab=revisao">pendências de revisão</a></div></div>
        </div>
        <section class="panel">
          <div class="panel-head"><h2>Esta semana</h2><span class="muted">${calendarTitle('week', anchor)}</span><div class="actions"><a class="btn sm ghost" href="#/calendario">Abrir calendário</a></div></div>
          <div id="dash-cal">${calendarHTML({ mode: 'week', anchor, legs: weekLegs })}</div>
          <div style="margin-top:12px">${legend()}</div>
        </section>
      </div>
      <div class="stack" style="gap:18px">
        <section class="panel">
          <div class="panel-head"><h2>Próximas pernas</h2></div>
          ${data.upcoming.length ? html`<div class="mini-legs">${data.upcoming.map((l) => html`
            <a class="mini-leg" data-origin="${l.data_origin}" href="#/escalas/${l.schedule_id}" style="color:inherit;text-decoration:none">
              <span class="bar"></span>
              <span class="when"><b>${legTime(l, 'dep').t}</b>${fmtDate(l.local_date, { year: false })}</span>
              <span><b>${l.flight_number || 'POS'}</b> ${l.adep} → ${l.ades}<br><small class="muted">${l.registration || 'sem matrícula'} · ${l.schedule_name}</small></span>
              <span class="muted small">${fmtDur(l.block_min)}</span>
            </a>`)}</div>` : html`<p class="muted">Sem pernas futuras.</p>`}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Escalas recentes</h2><div class="actions"><a class="btn sm ghost" href="#/escalas">Ver todas</a></div></div>
          ${data.schedules.length ? data.schedules.map((s) => html`
            <a class="sched-item" href="#/escalas/${s.id}">
              <span class="n">${s.name}</span>
              <span class="mixbar" title="${s.real_legs} reais · ${s.proj_legs} projetadas · ${s.other_legs} outras">
                ${s.legs ? html`<i style="width:${s.real_legs / s.legs * 100}%;background:var(--real)"></i><i style="width:${s.proj_legs / s.legs * 100}%;background:var(--proj)"></i><i style="width:${s.other_legs / s.legs * 100}%;background:var(--sugg)"></i>` : ''}
              </span>
              <span class="m">${airlineTag(s.airline)} · ${s.registration || 'sem matrícula'} · ${fmtDate(s.start_date, { year: false })} a ${fmtDate(s.end_date)}</span>
              <span class="m">${s.legs} pernas</span>
            </a>`) : html`<p class="muted">Nenhuma escala gerada ainda.</p>`}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Cobertura dos dados</h2></div>
          <table class="tbl"><thead><tr><th>Cia</th><th>Validade RPL</th><th>Tipos</th></tr></thead><tbody>
          ${m.airlines.map((a) => html`<tr><td>${airlineTag(a.code)}</td><td>${a.coverage ? `${fmtDate(a.coverage.from, { year: false })} a ${fmtDate(a.coverage.to)}` : html`<span class="muted">sem RPL</span>`}</td><td class="small text-2">${a.types.join(', ') || '—'}</td></tr>`)}
          </tbody></table>
          <p class="hint" style="margin-top:10px">Fora da validade, o gerador pode projetar o padrão semanal do RPL — essas pernas aparecem em ciano e não são garantidas.</p>
        </section>
      </div>
    </div>`);

  bindCalendar($('#dash-cal', el), () => weekLegs);
  const btn = $('#imp-samples', el);
  if (btn) btn.addEventListener('click', () => withBusy(btn, async () => {
    try {
      const r = await api('/rpl/import-samples', { method: 'POST' });
      const ok = r.results.filter((x) => x.ok);
      toast(`${ok.length} arquivo(s) importado(s): ${ok.map((x) => `${x.airline} (${x.records} registros)`).join(', ')}`);
      await refreshMeta();
      render(el);
    } catch (e) { toastError(e); }
  }));
  const timer = setInterval(() => { const c = el.querySelector('.countdown'); if (c && next) c.textContent = countdown(next.dep_utc); }, 30000);
  return () => clearInterval(timer);
}
