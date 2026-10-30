import { html, mount, icon, $, state, qs } from '../core.js';
import { WEBEYE, webeyeUrl, openWebeye } from '../ivao.js';

const LS = 'aeroscale.webeye';
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* */ } };

export async function render(el) {
  const prev = load();
  const p = qs();
  let url = p.get('callsign') ? webeyeUrl({ callsign: p.get('callsign') })
    : p.get('icao') ? webeyeUrl({ icao: p.get('icao') }) : (prev.url || WEBEYE);
  const icaos = state.meta.airports.filter((a) => a.lat != null).map((a) => a.icao);
  mount(el, html`
    <div class="page-head"><div><h1>IVAO Webeye</h1><p class="lead">Mapa ao vivo da rede IVAO: pilotos e controladores online. Centralize num aeroporto ou siga um indicativo.</p></div>
      <div class="actions"><button class="btn primary" id="we-pop">${icon('external')}Abrir em janela separada</button></div></div>
    <div class="panel" style="margin-bottom:12px"><div class="row" style="align-items:flex-end">
      <label class="field" style="width:170px">Aeroporto (ICAO)<input class="input" id="we-icao" list="we-aps" placeholder="SBGR" value="${p.get('icao') || prev.icao || ''}" style="text-transform:uppercase"></label>
      <datalist id="we-aps">${icaos.map((i) => html`<option value="${i}">`)}</datalist>
      <label class="field" style="width:120px">Zoom<select class="input" id="we-zoom">${[6, 7, 8, 9, 10, 11].map((z) => html`<option ${z === (prev.zoom || 9) ? 'selected' : ''}>${z}</option>`)}</select></label>
      <button class="btn" id="we-center">${icon('radar')}Centralizar</button>
      <label class="field" style="width:190px">Indicativo (callsign)<input class="input" id="we-cs" placeholder="GLO1016 ou SBGR_APP" value="${p.get('callsign') || prev.cs || ''}" style="text-transform:uppercase"></label>
      <button class="btn" id="we-follow">${icon('eye')}Seguir</button>
      <button class="btn ghost" id="we-reset">${icon('refresh')}Mapa inteiro</button>
    </div><p class="hint" style="margin-top:8px">Se o mapa não aparecer abaixo, o site da IVAO não permite ser exibido dentro de outro site: use "Abrir em janela separada" (a mesma janela é reaproveitada pelos botões do briefing).</p></div>
    <div class="webeye-frame"><iframe id="we-if" src="${url}" title="IVAO Webeye" allow="fullscreen; geolocation" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`);
  const go = (u, extra = {}) => { url = u; $('#we-if', el).src = u; save({ ...load(), url: u, ...extra }); };
  $('#we-center', el).onclick = () => { const i = $('#we-icao', el).value.trim().toUpperCase(); const z = +$('#we-zoom', el).value; go(webeyeUrl({ icao: i, zoom: z }), { icao: i, zoom: z }); };
  $('#we-follow', el).onclick = () => { const c = $('#we-cs', el).value.trim().toUpperCase(); if (c) go(webeyeUrl({ callsign: c }), { cs: c }); };
  $('#we-reset', el).onclick = () => go(WEBEYE);
  $('#we-pop', el).onclick = () => openWebeye(url);
  $('#we-icao', el).onkeydown = (e) => { if (e.key === 'Enter') $('#we-center', el).click(); };
  $('#we-cs', el).onkeydown = (e) => { if (e.key === 'Enter') $('#we-follow', el).click(); };
}
