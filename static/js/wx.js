// Componentes de meteorologia: cartão de METAR decodificado e bloco de TAF.
import { html, icon } from './core.js';

export const CAT = {
  VFR: { cls: 'real', text: 'VFR', tip: 'teto > 3000 ft e visibilidade > 8 km' },
  MVFR: { cls: 'proj', text: 'MVFR', tip: 'teto 1000–3000 ft ou visibilidade 4,8–8 km' },
  IFR: { cls: 'err', text: 'IFR', tip: 'teto 500–999 ft ou visibilidade 1,6–4,8 km' },
  LIFR: { cls: 'sugg', text: 'LIFR', tip: 'teto < 500 ft ou visibilidade < 1,6 km' },
};
const FRESH = { atual: 'ok', atrasado: 'warn', desatualizado: 'err', indisponivel: 'err' };

const hm = (iso) => (iso || '').slice(11, 16);
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

export function windText(w) {
  if (!w) return '—';
  if (w.calm) return 'Calmo';
  const dir = w.variable ? 'Variável' : `${String(w.dir).padStart(3, '0')}°`;
  return `${dir} ${w.speed_kt} kt${w.gust_kt ? `, rajadas ${w.gust_kt} kt` : ''}${w.var_from != null ? ` (varia ${w.var_from}°–${w.var_to}°)` : ''}`;
}

function windArrow(w) {
  if (!w || w.calm || w.variable || w.dir == null) return '';
  // seta aponta para onde o vento sopra (direção + 180)
  return html`<svg class="wind-arrow" viewBox="0 0 24 24" style="transform:rotate(${(w.dir + 180) % 360}deg)" aria-hidden="true"><path d="M12 3v16M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function metarCard(item, { title = '', taf = null, compact = false } = {}) {
  if (!item) return html`<div class="wx-card"><div class="wx-head"><b>${title}</b></div><p class="muted">Sem dados.</p></div>`;
  const m = item.metar;
  const cat = m && CAT[m.flight_category];
  const fr = item.freshness || {};
  return html`<article class="wx-card ${cat ? `cat-${m.flight_category}` : ''}">
    <div class="wx-head">
      <div><b class="wx-icao">${item.icao}</b> <span class="muted small">${title}</span></div>
      <div class="row" style="gap:6px">${cat ? html`<span class="badge ${cat.cls}" title="${cat.tip}">${cat.text}</span>` : ''}
        <span class="badge ${FRESH[fr.status] || ''}" title="Hora da observação">${m ? `${hm(m.time)}Z · ${fr.label}` : 'indisponível'}</span></div>
    </div>
    ${m ? html`
      <code class="wx-raw">${m.raw}</code>
      <div class="wx-grid">
        <div><span>Vento</span><b>${windArrow(m.wind)}${windText(m.wind)}</b></div>
        <div><span>Visibilidade</span><b>${m.visibility ? m.visibility.text : '—'}</b></div>
        <div><span>Teto</span><b>${m.cavok ? 'CAVOK' : m.ceiling_ft != null ? `${m.ceiling_ft} ft` : 'sem teto'}</b></div>
        <div><span>Temp. / orvalho</span><b>${m.temp_c ?? '—'} / ${m.dewpoint_c ?? '—'} °C${m.humidity_pct != null ? html` <small class="muted">${m.humidity_pct}%</small>` : ''}</b></div>
        <div><span>QNH</span><b>${m.qnh_hpa ? `${m.qnh_hpa} hPa` : '—'}</b></div>
        ${compact ? '' : html`<div class="wide"><span>Tempo presente</span><b>${m.weather.length ? m.weather.map((w) => w.text).join(', ') : 'nada significativo'}</b></div>
        <div class="wide"><span>Nuvens</span><b>${m.clouds.length ? m.clouds.map((c) => c.text).join('; ') : m.cavok ? 'CAVOK (sem nuvens abaixo de 5000 ft, sem CB)' : '—'}</b></div>
        ${m.trend ? html`<div class="wide"><span>Tendência</span><b>${m.trend}</b></div>` : ''}`}
      </div>
      ${m.alerts.length ? html`<div class="strip-checks" style="margin:8px 0 0">${m.alerts.map((a) => html`<div class="${a.level}">${icon(a.level === 'info' ? 'info' : 'alert')}${a.text}</div>`)}</div>` : ''}
      <div class="hint" style="margin-top:6px">Fonte: ${item.source || '—'}${item.error ? html` · <span style="color:var(--warn)">última consulta falhou: ${item.error}</span>` : ''}</div>`
    : html`<div class="notice warn" style="margin-top:8px">${icon('alert')}<div>METAR indisponível: ${item.error || 'sem dados'}.</div></div>`}
    ${taf !== null ? tafBlock(taf) : ''}
  </article>`;
}

export function tafBlock(t) {
  if (!t) return '';
  if (!t.available) return html`<div class="wx-taf muted small">TAF: ${t.error || 'não emitido para este aeródromo'}</div>`;
  const x = t.taf;
  return html`<details class="wx-taf" open><summary><b>TAF</b> <span class="muted small">aviationweather.gov · válido ${dmy(x.valid_from)} ${hm(x.valid_from)}Z a ${dmy(x.valid_to)} ${hm(x.valid_to)}Z${t.valid_now === false ? ' · fora da validade' : ''}</span></summary>
    <div class="raw" style="margin-top:6px">${(x.segments || [x.raw]).join('\n')}</div></details>`;
}
