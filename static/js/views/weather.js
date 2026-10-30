import { api, html, mount, icon, state, $, toastError, chipsInput, withBusy, qs } from '../core.js';
import { metarCard } from '../wx.js';

const LS = 'aeroscale.wx';
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* */ } };

export async function render(el) {
  const prev = load();
  const fromUrl = (qs().get('ids') || '').split(',').filter(Boolean);
  let ids = fromUrl.length ? fromUrl : (prev.ids || ['SBGR', 'SBSP', 'SBKP', 'SBGL', 'SBBR']);
  let auto = prev.auto ?? (state.meta.settings.metar_autorefresh_min || 0);
  let showTaf = prev.taf ?? true;
  let timer = null;
  let last = null;

  mount(el, html`
    <div class="page-head">
      <div><h1>Meteorologia</h1><p class="lead">METAR e TAF gratuitos (aviationweather.gov, com NOAA como reserva). Decodificação local, categoria de voo e alertas para o planejamento.</p></div>
    </div>
    <div class="panel" style="margin-bottom:18px"><div class="row" style="align-items:flex-end">
      <div class="field" style="flex:1;min-width:280px"><span>Aeródromos (ICAO)</span><div class="chips-input" id="wx-ids"></div></div>
      <label class="field" style="width:190px">Atualização automática<select class="input" id="wx-auto">
        ${[0, 5, 10, 15, 30].map((n) => html`<option value="${n}" ${+auto === n ? 'selected' : ''}>${n ? `a cada ${n} min` : 'desligada'}</option>`)}</select></label>
      <label class="check" style="height:36px"><input type="checkbox" id="wx-taf" ${showTaf ? 'checked' : ''}> Mostrar TAF</label>
      <button class="btn primary" id="wx-go">${icon('refresh')}Atualizar agora</button>
    </div>
    <p class="hint" style="margin-top:8px" id="wx-status">Cache de ${state.meta.settings.metar_ttl_min || 10} min no servidor; "Atualizar agora" ignora o cache.</p></div>
    <div class="wx-list" id="wx-list"><div class="skeleton"></div></div>`);

  const chips = chipsInput($('#wx-ids', el), ids, { placeholder: 'ICAO + Enter' });

  async function fetchAll(force = false, btn = null) {
    ids = chips.get();
    save({ ids, auto, taf: showTaf });
    if (!ids.length) { mount($('#wx-list', el), html`<div class="empty"><h3>Adicione um aeródromo</h3></div>`); return; }
    await withBusy(btn, async () => {
      try {
        const q = `ids=${ids.join(',')}${force ? '&force=1' : ''}`;
        const [m, t] = await Promise.all([api('/weather/metar?' + q), showTaf ? api('/weather/taf?' + q) : Promise.resolve({ items: [] })]);
        const tafs = Object.fromEntries(t.items.map((x) => [x.icao, x]));
        const apmap = Object.fromEntries(state.meta.airports.map((a) => [a.icao, a]));
        last = new Date();
        mount($('#wx-list', el), m.items.map((it) => metarCard(it, { title: apmap[it.icao]?.city || it.metar?.station_name || '', taf: showTaf ? (tafs[it.icao] || null) : null })));
        $('#wx-status', el).textContent = `Consultado às ${last.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · cache de ${m.ttl_min} min no servidor${auto ? ` · próxima atualização em ${auto} min` : ''}.`;
      } catch (e) { toastError(e); }
    });
  }
  function schedule() {
    if (timer) clearInterval(timer);
    timer = auto ? setInterval(() => fetchAll(false), auto * 60000) : null;
  }
  $('#wx-go', el).addEventListener('click', (e) => fetchAll(true, e.currentTarget));
  $('#wx-auto', el).addEventListener('change', (e) => { auto = +e.target.value; save({ ids: chips.get(), auto, taf: showTaf }); schedule(); fetchAll(false); });
  $('#wx-taf', el).addEventListener('change', (e) => { showTaf = e.target.checked; fetchAll(false); });
  $('#wx-ids', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') setTimeout(() => fetchAll(false), 50); });
  schedule();
  await fetchAll(false);
  return () => { if (timer) clearInterval(timer); };
}
