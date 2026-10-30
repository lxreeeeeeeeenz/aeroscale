import { api, html, mount, icon, state, $, toastError, toast, withBusy, refreshMeta, qs, confirmDialog, airlineTag } from '../core.js';

export async function render(el) {
  const p = qs();
  let tab = p.get('tab') || (p.get('google_error') || p.get('google_ok') ? 'google' : 'geral');
  if (p.get('google_error')) toast(p.get('google_error'), 'err', 9000);
  if (p.get('google_ok')) { toast('Google Calendar conectado.'); await refreshMeta(); }
  if (p.get('google_error') || p.get('google_ok')) history.replaceState(null, '', '#/configuracoes?tab=google');

  async function draw() {
    mount(el, html`
      <div class="page-head"><div><h1>Configurações</h1></div></div>
      <div class="tabs">${[['geral', 'Geral', 'gear'], ['companhias', 'Companhias', 'plane'], ['aeroportos', 'Aeroportos e fusos', 'tower'], ['google', 'Google Calendar', 'calendar'], ['backup', 'Backup e restauração', 'download'], ['dados', 'Dados de demonstração', 'flag']]
        .map(([id, l, ic]) => html`<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${icon(ic)}${l}</button>`)}</div>
      <div id="tab"></div>`);
    if (tab === 'geral') drawGeneral();
    if (tab === 'companhias') drawAirlines();
    if (tab === 'aeroportos') drawAirports();
    if (tab === 'google') await drawGoogle();
    if (tab === 'dados') drawData();
    if (tab === 'backup') await drawBackup();
  }

  function drawGeneral() {
    const s = state.meta.settings;
    mount($('#tab', el), html`<form class="panel" id="gen" style="max-width:900px"><div class="stack">
      <div class="form-grid">
        <label class="field">Exibir horários em<select class="input" name="display_tz"><option value="local">Hora local do aeroporto</option><option value="utc">UTC (Zulu)</option></select></label>
        <label class="field">Acréscimo de táxi (min)<input class="input" type="number" name="taxi_allowance_min" min="0" max="120" value="${s.taxi_allowance_min}"><span class="hint">Chegada = EOBT + EET + este valor (estimativa).</span></label>
        <label class="field">Solo mínimo padrão (min)<input class="input" type="number" name="min_turn_min" value="${s.min_turn_min}"></label>
        <label class="field">Solo máximo padrão (min)<input class="input" type="number" name="max_turn_min" value="${s.max_turn_min}"></label>
        <label class="field">Descanso noturno (min)<input class="input" type="number" name="min_rest_min" value="${s.min_rest_min}"></label>
        <label class="field">Pernas/dia mín.<input class="input" type="number" name="legs_min" value="${s.legs_min}"></label>
        <label class="field">Pernas/dia máx.<input class="input" type="number" name="legs_max" value="${s.legs_max}"></label>
        <label class="field">Início da janela<input class="input" type="time" name="day_start" value="${s.day_start}"></label>
        <label class="field">Fim da janela<input class="input" type="time" name="day_end" value="${s.day_end}"></label>
      </div>
      <label class="check"><input type="checkbox" name="projection_enabled" ${s.projection_enabled ? 'checked' : ''}> Projeção semanal ligada por padrão no gerador</label>
      <label class="check"><input type="checkbox" name="avoid_used_flights" ${s.avoid_used_flights ? 'checked' : ''}> Não reutilizar voos já atribuídos em outras escalas (padrão)</label>
      <label class="check"><input type="checkbox" name="rpl_autoimport" ${s.rpl_autoimport !== false ? 'checked' : ''}> Ao abrir, importar sozinho os RPL novos da pasta <code>rpl/</code></label>
      <label class="check"><input type="checkbox" name="model_realism" ${s.model_realism !== false ? 'checked' : ''}> Gerador prioriza sequências prováveis pelo modelo de rodízio (bate-voltas, continuação do mesmo voo)</label>
      <h3 style="margin-top:6px">Anormalidades</h3>
      <div class="form-grid">
        <label class="field">Chance de repetição de trecho (% dos dias)<input class="input" type="number" min="0" max="100" name="anomaly_repeat_pct" value="${s.anomaly_repeat_pct ?? 5}"><span class="hint">Vai-e-volta repetido no mesmo par (ex.: SBBR→SBSP→SBBR→SBSP) fica fora da escala normal. Nesta % de dias ele pode aparecer, marcado como anormalidade. 0 = nunca.</span></label>
      </div>
      <h3 style="margin-top:6px">Reserva automática</h3>
      <label class="check"><input type="checkbox" name="reserve_enabled" ${s.reserve_enabled !== false ? 'checked' : ''}> Incluir reserva nas escalas semanais (1 bloco) e mensais</label>
      <div class="form-grid">
        <label class="field">Blocos por escala mensal<input class="input" type="number" min="0" max="4" name="reserve_per_month" value="${s.reserve_per_month ?? 1}"></label>
        <label class="field">Duração mínima (dias)<input class="input" type="number" min="3" max="9" name="reserve_min_days" value="${s.reserve_min_days ?? 3}"></label>
        <label class="field">Duração máxima (dias)<input class="input" type="number" min="3" max="9" name="reserve_max_days" value="${s.reserve_max_days ?? 9}"></label>
        <label class="field">Chance de ser na base (%)<input class="input" type="number" min="0" max="100" name="reserve_base_pct" value="${s.reserve_base_pct ?? 80}"></label>
        <label class="field">Chance de acionamento (%)<input class="input" type="number" min="0" max="100" name="reserve_activation_pct" value="${s.reserve_activation_pct ?? 50}"></label>
        <label class="field">Acionamento dura até (dias)<input class="input" type="number" min="1" max="9" name="reserve_activation_max_days" value="${s.reserve_activation_max_days ?? 3}"></label>
      </div>
      <p class="hint">Duração sorteada sempre entre 3 e 9 dias seguidos. Com as regras de tripulação ligadas, reservas acima de 6 dias somadas aos dias de trabalho geram aviso de dias seguidos (a reserva conta como dia de trabalho).</p>
      <h3 style="margin-top:6px">SimBrief</h3>
      <div class="form-grid">
        <label class="field">Unidade de peso<select class="input" name="simbrief_units"><option value="KGS">kg</option><option value="LBS">lb</option></select></label>
        <label class="field">Texto do RMK/<input class="input" name="simbrief_rmk" value="${s.simbrief_rmk ?? 'TCAS'}" style="text-transform:uppercase"><span class="hint">Vai depois de EQPT/, PBN/ e OPR/ no campo de observações.</span></label>
        <label class="field" style="grid-column:1/-1">Alternado fixo por destino<textarea class="input" name="simbrief_alternates" rows="2" placeholder="SBFZ=SBJP, SBGL=SBGR" style="text-transform:uppercase">${Object.entries(s.simbrief_alternates || {}).map(([k, v]) => `${k}=${v}`).join(', ')}</textarea><span class="hint">Sem alternado fixo, o AeroScale sugere o aeroporto mais próximo do destino (10–450 km) com pista suficiente, de preferência atendido pela própria companhia.</span></label>
      </div>
      <h3 style="margin-top:6px">Meteorologia</h3>
      <div class="form-grid">
        <label class="field">Cache do METAR no servidor (min)<input class="input" type="number" min="1" max="120" name="metar_ttl_min" value="${s.metar_ttl_min || 10}"><span class="hint">Evita consultas repetidas à API gratuita.</span></label>
        <label class="field">Atualização automática nas telas<select class="input" name="metar_autorefresh_min">${[0, 5, 10, 15, 30].map((n) => html`<option value="${n}" ${+s.metar_autorefresh_min === n ? 'selected' : ''}>${n ? `a cada ${n} min` : 'desligada'}</option>`)}</select></label>
      </div>
      <p class="hint">Fontes: aviationweather.gov (METAR e TAF, NOAA/AWC) e NOAA tgftp como reserva. Ambas gratuitas e sem chave.</p>
      <div><button class="btn primary" type="submit">Salvar configurações</button></div></div></form>`);
    const f = $('#gen', el);
    f.display_tz.value = s.display_tz;
    f.simbrief_units.value = s.simbrief_units || 'KGS';
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      body.projection_enabled = f.projection_enabled.checked; body.avoid_used_flights = f.avoid_used_flights.checked;
      body.model_realism = f.model_realism.checked;
      body.reserve_enabled = f.reserve_enabled.checked;
      body.rpl_autoimport = f.rpl_autoimport.checked;
      try { await api('/settings', { method: 'PUT', body }); await refreshMeta(); toast('Configurações salvas.'); } catch (er) { toastError(er); }
    });
  }

  function drawAirlines() {
    mount($('#tab', el), html`<div class="grid grid-dash">
      <div class="table-wrap"><table class="tbl"><thead><tr><th>ICAO</th><th>IATA</th><th>Nome</th><th>Cor</th><th>RPL</th><th></th></tr></thead><tbody>
      ${state.meta.airlines.map((a) => html`<tr data-code="${a.code}"><td class="strong">${a.code}${a.needs_review ? html` <span class="badge warn">revisar</span>` : ''}</td>
        <td><input class="input sm" data-k="iata" value="${a.iata || ''}" maxlength="2" style="width:60px"></td>
        <td><input class="input sm" data-k="name" value="${a.name}"></td>
        <td><input type="color" data-k="color" value="${a.color}" style="width:40px;height:28px;border:0;background:none"></td>
        <td class="small text-2">${a.coverage ? `${a.coverage.records} registros` : '—'}</td>
        <td><button class="btn sm" data-save="${a.code}">Salvar</button></td></tr>`)}
      </tbody></table></div>
      <form class="panel" id="new-al"><h3 style="margin-bottom:10px">Nova companhia</h3><div class="stack">
        <label class="field">Designador ICAO<input class="input" name="code" maxlength="3" required style="text-transform:uppercase" placeholder="ex.: PTB"></label>
        <label class="field">IATA<input class="input" name="iata" maxlength="2"></label>
        <label class="field">Nome<input class="input" name="name" required></label>
        <label class="field">Cor<input type="color" name="color" value="#9AA7B5"></label>
        <button class="btn primary" type="submit">${icon('plus')}Adicionar</button>
        <p class="hint">Companhias também são criadas automaticamente ao importar um RPL com designador novo. Depois, importe a lista de frota e crie os campos de configuração específicos dela.</p></div></form></div>`);
    $('#new-al', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/airlines', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); await refreshMeta(); toast('Companhia criada.'); drawAirlines(); } catch (er) { toastError(er); }
    });
    $('#tab', el).onclick = async (e) => {
      const b = e.target.closest('[data-save]'); if (!b) return;
      const tr = b.closest('tr'); const v = (k) => tr.querySelector(`[data-k="${k}"]`).value;
      try { await api(`/airlines/${b.dataset.save}`, { method: 'PUT', body: { iata: v('iata'), name: v('name'), color: v('color') } }); await refreshMeta(); toast('Companhia salva.'); drawAirlines(); } catch (er) { toastError(er); }
    };
  }

  function drawAirports() {
    const aps = state.meta.airports;
    const pre = qs().get('icao') || '';
    mount($('#tab', el), html`<div class="grid grid-dash">
      <div><input class="input sm" id="ap-q" placeholder="Filtrar por ICAO, cidade ou nome" style="max-width:320px;margin-bottom:10px">
        <div class="table-wrap" style="max-height:640px"><table class="tbl"><thead><tr><th>ICAO</th><th>IATA</th><th>Nome</th><th>Cidade/UF</th><th>Fuso</th><th>Origem</th><th></th></tr></thead><tbody id="ap-body">
        ${aps.map((a) => html`<tr data-q="${`${a.icao} ${a.iata || ''} ${a.city || ''} ${a.name || ''}`.toLowerCase()}"><td class="strong">${a.icao}</td><td>${a.iata || ''}</td><td>${a.name}</td><td>${a.city}${a.uf ? `/${a.uf}` : ''}</td><td class="small">${a.tz || html`<span class="badge warn">sem fuso</span>`}</td><td class="small muted">${a.source}</td>
          <td><button class="icon-btn" data-edit="${a.icao}" title="Editar">${icon('edit')}</button>${a.source === 'manual' ? html`<button class="icon-btn danger" data-del="${a.icao}" title="Remover cadastro manual">${icon('trash')}</button>` : ''}</td></tr>`)}
        </tbody></table></div></div>
      <form class="panel" id="ap-form"><h3 style="margin-bottom:10px">Cadastrar / corrigir aeroporto</h3><div class="stack">
        <label class="field">ICAO<input class="input" name="icao" maxlength="4" required style="text-transform:uppercase" value="${pre}"></label>
        <label class="field">IATA<input class="input" name="iata" maxlength="3"></label>
        <label class="field">Nome<input class="input" name="name"></label>
        <div class="row" style="flex-wrap:nowrap"><label class="field" style="flex:1">Cidade<input class="input" name="city"></label><label class="field" style="width:70px">UF<input class="input" name="uf" maxlength="2"></label></div>
        <label class="field">Fuso IANA<input class="input" name="tz" list="tz-list" placeholder="America/Sao_Paulo"><span class="hint">Brasil não tem horário de verão desde 2019.</span></label>
        <datalist id="tz-list">${['America/Noronha', 'America/Sao_Paulo', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Maceio', 'America/Belem', 'America/Santarem', 'America/Araguaina', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Eirunepe', 'UTC'].map((t) => html`<option value="${t}">`)}</datalist>
        <button class="btn primary" type="submit">Salvar aeroporto</button>
        <p class="hint">O cadastro manual tem prioridade sobre a tabela embutida.</p></div></form></div>`);
    const f = $('#ap-form', el);
    if (pre) { const a = aps.find((x) => x.icao === pre); if (a) fill(a); }
    function fill(a) { ['icao', 'iata', 'name', 'city', 'uf', 'tz'].forEach((k) => { f[k].value = a[k] || ''; }); }
    $('#ap-q', el).addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); el.querySelectorAll('#ap-body tr').forEach((tr) => { tr.hidden = q && !tr.dataset.q.includes(q); }); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/airports', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); await refreshMeta(); toast('Aeroporto salvo.'); drawAirports(); } catch (er) { toastError(er); }
    });
    $('#tab', el).onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) { fill(aps.find((x) => x.icao === ed.dataset.edit)); f.scrollIntoView({ behavior: 'smooth' }); return; }
      const dl = e.target.closest('[data-del]');
      if (dl && await confirmDialog(`Remover o cadastro manual de ${dl.dataset.del}? Se existir na tabela embutida, ela volta a valer.`, { ok: 'Remover', danger: true })) {
        try { await api(`/airports/${dl.dataset.del}`, { method: 'DELETE' }); await refreshMeta(); drawAirports(); } catch (er) { toastError(er); }
      }
    };
  }

  async function drawGoogle() {
    const g = (await api('/google/status'));
    const redirect = state.meta.settings.google_redirect_uri || `${location.origin}/api/google/callback`;
    let cals = null;
    if (g.connected) { try { cals = await api('/google/calendars'); } catch (e) { toastError(e); } }
    mount($('#tab', el), html`<div class="grid grid-dash">
      <div class="stack" style="gap:18px">
        <section class="panel"><div class="panel-head"><h2>Status</h2></div>
          <dl class="kv"><dt>Credencial OAuth</dt><dd>${g.configured ? html`<span class="badge ok">enviada</span> tipo ${g.client_type === 'web' ? 'Aplicativo da Web' : 'Computador'}${g.project_id ? ` · projeto ${g.project_id}` : ''}` : html`<span class="badge warn">não enviada</span>`}</dd>
            <dt>Conta Google</dt><dd>${g.connected ? html`<span class="badge ok">conectada</span> desde ${g.connected_at?.slice(0, 16).replace('T', ' ')}Z` : html`<span class="badge">não conectada</span>`}</dd>
            <dt>URI de redirecionamento</dt><dd><code>${redirect}</code></dd></dl>
          <div class="row" style="margin-top:16px">
            <label class="btn">${icon('upload')}${g.configured ? 'Trocar' : 'Enviar'} credencial JSON<input type="file" id="g-file" accept=".json,application/json" hidden></label>
            ${g.configured && !g.connected ? html`<a class="btn primary" href="/api/google/auth">${icon('link')}Conectar conta Google</a>` : ''}
            ${g.connected ? html`<a class="btn" href="/api/google/auth">${icon('refresh')}Reconectar</a><button class="btn danger" id="g-disc">${icon('power')}Desconectar</button>` : ''}
          </div></section>
        ${g.connected ? html`<section class="panel"><div class="panel-head"><h2>Agenda padrão</h2></div>
          ${cals ? html`<div class="row"><select class="input" id="g-cal" style="max-width:420px">${cals.items.map((c) => html`<option value="${c.id}" ${c.id === cals.selected ? 'selected' : ''}>${c.summary}${c.primary ? ' (principal)' : ''}</option>`)}</select>
            <button class="btn" id="g-save">Usar esta agenda</button><button class="btn" id="g-new">${icon('plus')}Criar agenda "AeroScale – Escalas"</button></div>
            <p class="hint" style="margin-top:8px">Recomendado: uma agenda separada, fácil de ocultar ou apagar inteira.</p>` : html`<p class="muted">Não foi possível listar as agendas.</p>`}</section>` : ''}
      </div>
      <aside class="panel"><h3 style="margin-bottom:10px">Configurar credenciais (uma vez)</h3>
        <ol class="text-2" style="margin:0;padding-left:18px;display:grid;gap:9px;font-size:13.5px">
          <li>Acesse <b>console.cloud.google.com</b> e crie (ou escolha) um projeto.</li>
          <li>Em <b>APIs e serviços → Biblioteca</b>, ative a <b>Google Calendar API</b>.</li>
          <li>Em <b>Tela de consentimento OAuth</b>, escolha "Externo", preencha nome e e-mail e adicione seu e-mail em <b>Usuários de teste</b>.</li>
          <li>Em <b>Credenciais → Criar credenciais → ID do cliente OAuth</b>, escolha <b>Aplicativo da Web</b>.</li>
          <li>Em "URIs de redirecionamento autorizados" adicione exatamente <code>${redirect}</code> (e a variante com 127.0.0.1, se usar esse endereço).</li>
          <li>Baixe o JSON e envie aqui. Depois clique em <b>Conectar conta Google</b>.</li>
        </ol>
        <p class="hint" style="margin-top:12px">O token fica só no seu computador (pasta <code>data/</code>). Escopo solicitado: Google Calendar (ler e criar eventos/agendas).</p></aside></div>`);
    $('#g-file', el)?.addEventListener('change', async (e) => {
      const fd = new FormData(); fd.append('file', e.target.files[0]);
      try { await api('/google/credentials', { method: 'POST', form: fd }); toast('Credencial salva. Agora conecte sua conta.'); await refreshMeta(); drawGoogle(); } catch (er) { toastError(er); }
    });
    $('#g-disc', el)?.addEventListener('click', async () => {
      if (!await confirmDialog('Desconectar o Google Calendar? Os eventos já criados continuam na agenda.', { ok: 'Desconectar', danger: true })) return;
      try { await api('/google/disconnect', { method: 'POST' }); await refreshMeta(); toast('Desconectado.'); drawGoogle(); } catch (er) { toastError(er); }
    });
    $('#g-save', el)?.addEventListener('click', async () => {
      try { await api('/settings', { method: 'PUT', body: { google_calendar_id: $('#g-cal', el).value } }); await refreshMeta(); toast('Agenda padrão salva.'); } catch (er) { toastError(er); }
    });
    $('#g-new', el)?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { await api('/google/calendars', { method: 'POST', body: {} }); await refreshMeta(); toast('Agenda criada e selecionada.'); drawGoogle(); } catch (er) { toastError(er); }
    }));
  }

  async function drawBackup() {
    const { items, data_dir: dataDir } = await api('/backup/points');
    mount($('#tab', el), html`<div class="grid grid-2">
      <section class="panel"><div class="stack">
        <h2>Exportar backup completo</h2>
        <p class="text-2">Gera um único arquivo .zip com tudo: RPL importados (e os arquivos originais), frota, campos, histórico, escalas, configurações e, se quiser, a ligação com o Google Calendar. Guarde num pendrive ou na nuvem antes de formatar o Windows.</p>
        <label class="check"><input type="checkbox" id="bk-cred" checked> Incluir credencial OAuth do Google (arquivo do Google Cloud)</label>
        <label class="check"><input type="checkbox" id="bk-token"> Incluir autorização da minha conta Google (evita conectar de novo; trate o arquivo como senha)</label>
        <div><button class="btn primary" id="bk-export">${icon('download')}Baixar backup (.zip)</button></div>
      </div></section>
      <section class="panel"><div class="stack">
        <h2>Restaurar backup</h2>
        <p class="text-2">No Windows novo: instale o Python, rode o <b>iniciar.bat</b> e envie aqui o .zip. Os dados atuais são substituídos; antes disso o AeroScale salva um ponto de restauração automático.</p>
        <label class="dropzone" id="bk-dz" style="padding:22px">${icon('upload')}<b>Escolher arquivo de backup</b><span>aeroscale-backup-AAAAMMDD-HHMM.zip</span><input type="file" id="bk-file" accept=".zip" hidden></label>
        <div id="bk-res"></div>
      </div></section>
    </div>
    <section class="panel" style="margin-top:18px">
      <div class="panel-head"><h2>Pontos de restauração</h2><span class="muted small">Pasta: <code>${dataDir}</code></span><div class="actions"><button class="btn sm" id="bk-point">${icon('plus')}Criar ponto agora</button></div></div>
      ${items.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Arquivo</th><th>Criado</th><th class="num">Tamanho</th><th></th></tr></thead><tbody>
        ${items.map((x) => html`<tr><td>${x.name}</td><td>${x.created_at}</td><td class="num">${(x.size / 1024 / 1024).toFixed(1)} MB</td><td><a class="btn sm" href="/api/backup/points/${encodeURIComponent(x.name)}" download>${icon('download')}Baixar</a></td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Nenhum ponto de restauração ainda. Eles são criados automaticamente antes de cada restauração (os 10 mais recentes ficam guardados).</p>`}
      <p class="hint" style="margin-top:10px">Pelo terminal também funciona: <code>python app.py --backup meu_backup.zip</code> e <code>python app.py --restore meu_backup.zip</code>. Outra opção é copiar a pasta <code>data</code> inteira.</p>
    </section>`);
    $('#bk-export', el).addEventListener('click', () => {
      const q = new URLSearchParams({ credentials: $('#bk-cred', el).checked ? '1' : '0', token: $('#bk-token', el).checked ? '1' : '0' });
      const a = document.createElement('a'); a.href = '/api/backup/export?' + q; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
      toast('Backup gerado. Confira a pasta de downloads.');
    });
    $('#bk-point', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { const r = await api('/backup/points', { method: 'POST' }); toast(`Ponto criado: ${r.name}`); drawBackup(); } catch (er) { toastError(er); }
    }));
    $('#bk-file', el).addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (!await confirmDialog(`Restaurar "${file.name}"? Os dados atuais serão substituídos (um ponto de restauração é criado antes).`, { ok: 'Restaurar', danger: true })) { e.target.value = ''; return; }
      const fd = new FormData(); fd.append('file', file);
      mount($('#bk-res', el), html`<div class="skeleton" style="height:48px"></div>`);
      try {
        const r = await api('/backup/import', { method: 'POST', form: fd });
        const c = r.counts;
        mount($('#bk-res', el), html`<div class="notice">${icon('check')}<div><b>Backup restaurado</b> (criado em ${r.manifest.created_at.slice(0, 16).replace('T', ' ')} UTC, versão ${r.manifest.version}).<br>
          ${c.rpl_imports} importação(ões) RPL, ${c.aircraft} aeronave(s), ${c.schedules} escala(s) com ${c.schedule_legs} perna(s), ${r.files} arquivo(s) original(is)${r.google.length ? `, ligação Google (${r.google.length} arquivo(s))` : ''}.<br>
          <span class="muted small">Ponto de restauração anterior: ${r.restore_point}</span></div></div>`);
        await refreshMeta();
      } catch (er) { toastError(er); mount($('#bk-res', el), ''); }
      e.target.value = '';
    });
  }

  function drawData() {
    mount($('#tab', el), html`<div class="panel" style="max-width:820px"><div class="stack">
      <h2>Aeronaves fictícias</h2>
      <p class="text-2">Para testar o gerador antes de importar a frota real, carregue 10 aeronaves fictícias (prefixo <b>FIC-</b>, marcadas como FICTÍCIA em todas as telas). Elas não existem e as configurações são inventadas para demonstração.</p>
      <div class="row"><button class="btn primary" id="d-load">Carregar aeronaves fictícias</button><button class="btn danger" id="d-rm">${icon('trash')}Remover todas as fictícias</button></div>
      <hr><h2>Arquivos de exemplo</h2>
      <p class="text-2">A pasta <code>rpl/</code> guarda os RPL (AZU, GLO, TAM…), importados sozinhos ao abrir o AeroScale. A pasta <code>samples/frota</code> traz duas listas de frota <b>fictícias</b> em formatos diferentes para testar a importação.</p>
      <div class="row"><a class="btn" href="#/importacoes">Ir para Importar RPL</a><a class="btn" href="#/frota?tab=importar">Ir para Importar lista de frota</a></div></div></div>`);
    $('#d-load', el).addEventListener('click', async () => { try { const r = await api('/fleet/demo', { method: 'POST' }); await refreshMeta(); toast(`${r.created} aeronave(s) fictícia(s) criada(s).`); } catch (er) { toastError(er); } });
    $('#d-rm', el).addEventListener('click', async () => {
      if (!await confirmDialog('Remover todas as aeronaves fictícias? Escalas que as usam ficam sem matrícula.', { ok: 'Remover', danger: true })) return;
      try { const r = await api('/fleet/demo', { method: 'DELETE' }); await refreshMeta(); toast(`${r.removed} aeronave(s) removida(s).`); } catch (er) { toastError(er); }
    });
  }

  el.onclick = (e) => { const t = e.target.closest('.tabs [data-tab]'); if (t) { tab = t.dataset.tab; draw(); } };
  await draw();
  return () => { el.onclick = null; };
}
