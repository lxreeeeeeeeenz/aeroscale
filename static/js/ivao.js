// IVAO Webeye: links e janela separada reaproveitada.
import { state } from './core.js';

export const WEBEYE = 'https://webeye.ivao.aero/';

// O Webeye aceita ?center=<longitude>;<latitude>&zoom=N e ?callsign=XXX (wiki da IVAO).
export function webeyeUrl({ icao = null, callsign = null, zoom = 9 } = {}) {
  if (callsign) return `${WEBEYE}?callsign=${encodeURIComponent(callsign.toUpperCase())}`;
  const a = icao && state.meta.airports.find((x) => x.icao === icao.toUpperCase());
  if (a && a.lat != null) return `${WEBEYE}?center=${a.lon.toFixed(4)};${a.lat.toFixed(4)}&zoom=${zoom}`;
  return WEBEYE;
}

let win = null;
export function openWebeye(url = WEBEYE) {
  const w = Math.min(1400, screen.availWidth - 80), h = Math.min(900, screen.availHeight - 80);
  if (win && !win.closed) {
    win.location.href = url;
    win.focus();
    return win;
  }
  win = window.open(url, 'aeroscale-webeye', `popup=yes,width=${w},height=${h},left=40,top=40`);
  if (!win) window.open(url, '_blank', 'noopener');  // bloqueador de pop-up: abre em aba
  return win;
}
