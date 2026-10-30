import { api, html, mount, icon, $, toastError, toast, withBusy, airlineTag, fmtDate, confirmDialog, download, refreshMeta } from '../core.js';

export async function render(el) {
  async function draw(results = null) {
    const { imports } = await api('/rpl/imports');
    mount(el, html`
      <div class="page-head"><div><h1>Importar RPL</h1><p class="lead">Arquivos TXT "Planos de Voo Repetitivos" do CGNA/DECEA. O parser lê as colunas a partir do cabeçalho do próprio arquivo, preserva o texto original e sinaliza registros inconsistentes.</p></div></div>
      <div class="grid grid-dash">
        <div class="panel"><div class="stack">
          <label class="dropzone" id="dz">${icon('inbox')}<b>Solte os arquivos RPL aqui ou clique para escolher</b><span>Um ou vários .txt (AZU, GLO, TAM ou qualquer outra companhia)</span><input type="file" id="file" accept=".txt" multiple hidden></label>
          <label class="check"><input type="checkbox" id="replace" checked> Desativar importações anteriores da mesma companhia com validade sobreposta</label>
          <label class="check"><input type="checkbox" id="force"> Reimportar mesmo se o arquivo já tiver sido importado</label>
          <div class="row"><button class="btn" id="samples">${icon('download')}Importar arquivos da pasta rpl/</button></div>
          <div id="results">${results ? resultsHTML(results) : ''}</div>
        </div></div>
        <aside class="panel"><h3 style="margin-bottom:10px">O que é lido de cada registro</h3>
          <dl class="kv" style="grid-template-columns:110px 1fr">
            <dt>Validade</dt><dd>VALIDO DESDE / ATÉ (DDMMAA)</dd><dt>Dias</dt><dd>STQQSSD: posição = dia (1 = segunda)</dd>
            <dt>Ident</dt><dd>Companhia + número do voo</dd><dt>Tipo/esteira</dt><dd>Designador ICAO / L, M, H, J</dd>
            <dt>ADEP + EOBT</dt><dd>Origem e horário de calços (UTC)</dd><dt>VEL / FL</dt><dd>Velocidade e nível</dd>
            <dt>Rota</dt><dd>Inclui linhas de continuação</dd><dt>DEST + EET</dt><dd>Destino e tempo estimado em voo</dd>
            <dt>Observações</dt><dd>EQPT, PBN, STS, DAT, RMK, EET por FIR…</dd></dl>
          <p class="hint" style="margin-top:12px">Chegada estimada = EOBT + EET + acréscimo de táxi configurável (Configurações). O RPL não traz matrícula.</p></aside>
      </div>
      <section class="panel" style="margin-top:18px">
        <div class="panel-head"><h2>Histórico de importações</h2><span class="muted small">Apenas importações ativas alimentam o gerador.</span></div>
        ${imports.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Cia</th><th>Arquivo</th><th>Validade do arquivo</th><th>Período dos registros</th><th class="num">Registros</th><th class="num">Avisos</th><th class="num">Erros</th><th>Importado</th><th>Ativa</th><th></th></tr></thead><tbody>
          ${imports.map((i) => html`<tr class="${i.active ? '' : 'inactive'}">
            <td>${i.id}</td><td>${airlineTag(i.airline)}</td><td class="strong">${i.filename}</td><td>${i.header_validity || '—'}</td>
            <td>${fmtDate(i.valid_from, { year: false })} a ${fmtDate(i.valid_to)}</td><td class="num">${i.record_count.toLocaleString('pt-BR')}</td>
            <td class="num">${i.warning_count ? html`<a href="#/voos?import_id=${i.id}&status=warning">${i.warning_count}</a>` : 0}</td>
            <td class="num">${i.error_count ? html`<a href="#/voos?import_id=${i.id}&status=error" style="color:var(--err)">${i.error_count}</a>` : 0}</td>
            <td class="small muted">${i.imported_at.slice(0, 16).replace('T', ' ')}Z</td>
            <td><input type="checkbox" data-toggle="${i.id}" ${i.active ? 'checked' : ''} aria-label="Ativa"></td>
            <td><div class="row" style="flex-wrap:nowrap">
              <a class="icon-btn" href="#/voos?import_id=${i.id}" title="Ver voos">${icon('eye')}</a>
              <button class="icon-btn" data-dl="${i.id}" title="Baixar arquivo original">${icon('download')}</button>
              ${i.file_issues.length ? html`<button class="icon-btn" data-issues="${i.id}" title="Avisos do arquivo">${icon('alert')}</button>` : ''}
              <button class="icon-btn danger" data-del="${i.id}" title="Excluir importação">${icon('trash')}</button></div></td></tr>
            ${i.file_issues.length ? html`<tr hidden data-issues-row="${i.id}"><td colspan="11"><div class="strip-checks">${i.file_issues.map((x) => html`<div class="${x.severity}">${icon('info')}${x.message}</div>`)}</div></td></tr>` : ''}`)}
        </tbody></table></div>` : html`<div class="empty"><h3>Nenhum arquivo importado</h3><p>Use a área acima ou importe os exemplos incluídos.</p></div>`}
      </section>`);

    const dz = $('#dz', el), inp = $('#file', el);
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); upload([...e.dataTransfer.files]); });
    inp.addEventListener('change', () => upload([...inp.files]));
    $('#samples', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { const r = await api('/rpl/import-samples', { method: 'POST' }); await refreshMeta(); await draw(r.results); } catch (er) { toastError(er); }
    }));
  }

  function resultsHTML(results) {
    return html`<div class="stack" style="gap:8px">${results.map((r) => r.ok ? html`<div class="notice ${r.warnings || r.errors ? 'warn' : ''}">${icon(r.errors ? 'alert' : 'check')}<div>
        <b>${r.filename}</b> · ${r.airline} · ${r.records.toLocaleString('pt-BR')} registros (${fmtDate(r.valid_from, { year: false })} a ${fmtDate(r.valid_to)}) · ${r.warnings} aviso(s), ${r.errors} erro(s)
        ${r.unknown_airports.length ? html`<br>Aeroportos sem cadastro: <b>${r.unknown_airports.join(', ')}</b> — <a href="#/configuracoes?tab=aeroportos&icao=${r.unknown_airports[0]}">cadastrar</a>` : ''}
        ${r.replaced_imports.length ? html`<br>Importações desativadas por sobreposição: #${r.replaced_imports.join(', #')}` : ''}
        ${r.airline_created ? html`<br>Companhia nova criada: revise o nome em Configurações.` : ''}</div></div>`
      : html`<div class="notice err">${icon('alert')}<div><b>${r.filename}</b>: ${r.error}</div></div>`)}</div>`;
  }

  async function upload(files) {
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('replace', $('#replace', el).checked ? '1' : '0');
    fd.append('force', $('#force', el).checked ? '1' : '0');
    mount($('#results', el), html`<div class="skeleton" style="height:48px"></div>`);
    try {
      const r = await api('/rpl/import', { method: 'POST', form: fd });
      const ok = r.results.filter((x) => x.ok).length;
      toast(`${ok} de ${r.results.length} arquivo(s) importado(s).`, ok === r.results.length ? 'ok' : 'warn');
      await refreshMeta();
      await draw(r.results);
    } catch (e) { toastError(e); mount($('#results', el), ''); }
  }

  el.onclick = async (e) => {
    const dl = e.target.closest('[data-dl]'); if (dl) { download(`/api/rpl/imports/${dl.dataset.dl}/original`); return; }
    const is = e.target.closest('[data-issues]'); if (is) { const r = el.querySelector(`[data-issues-row="${is.dataset.issues}"]`); if (r) r.hidden = !r.hidden; return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!await confirmDialog('Excluir esta importação e todos os seus registros? Pernas de escalas que usam esses voos continuam salvas, mas passarão a ser sinalizadas como "voo não encontrado".', { ok: 'Excluir', danger: true })) return;
      try { const r = await api(`/rpl/imports/${del.dataset.del}`, { method: 'DELETE' }); toast(`Importação excluída${r.legs_affected ? ` (${r.legs_affected} perna(s) afetadas)` : ''}.`); await refreshMeta(); draw(); } catch (er) { toastError(er); }
    }
  };
  el.onchange = async (e) => {
    const t = e.target.closest('[data-toggle]'); if (!t) return;
    try { await api(`/rpl/imports/${t.dataset.toggle}/active`, { method: 'POST', body: { active: t.checked } }); toast(t.checked ? 'Importação ativada.' : 'Importação desativada.'); await refreshMeta(); draw(); } catch (er) { toastError(er); }
  };
  await draw();
  return () => { el.onclick = null; el.onchange = null; };
}
