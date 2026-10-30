"""Exportação do briefing em HTML autônomo (abre offline e imprime bem)."""
from __future__ import annotations

from jinja2 import Environment, select_autoescape

ENV = Environment(autoescape=select_autoescape(default=True), trim_blocks=True, lstrip_blocks=True)


def _hm(iso: str | None) -> str:
    return (iso or "")[11:16]


def _dur(m) -> str:
    if m is None:
        return "—"
    m = int(round(m))
    return f"{m // 60}h{m % 60:02d}" if m >= 60 else f"{m} min"


ENV.filters["hm"] = _hm
ENV.filters["dur"] = _dur
ENV.filters["pct"] = lambda p: "—" if p is None else f"{p * 100:.0f}%"

CSS = """
*{box-sizing:border-box}body{font:13px/1.45 "Bahnschrift","Segoe UI",Arial,sans-serif;color:#111;margin:24px;background:#fff}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:18px 0 6px;border-bottom:2px solid #FF7A1A;padding-bottom:3px}
.muted{color:#666}.row{display:flex;gap:16px;flex-wrap:wrap}.box{border:1px solid #ccc;border-radius:8px;padding:10px 12px;flex:1;min-width:260px}
.big{font-size:28px;font-weight:700}.tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;border:1px solid #999}
.VFR{background:#d9f7e8}.MVFR{background:#dbeeff}.IFR{background:#ffe1e1}.LIFR{background:#f3d9ff}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
pre{white-space:pre-wrap;font:12px Consolas,monospace;background:#f5f5f5;padding:6px 8px;border-radius:6px;margin:4px 0}
.warn{color:#9a6400}.err{color:#b00020}.foot{margin-top:24px;font-size:11px;color:#666}
@media print{body{margin:10mm}.noprint{display:none}}
"""

METAR_MACRO = """
{% macro metar_box(title, m, taf) %}
<div class="box"><b>{{ title }}</b>
{% if m and m.available %}{% set d = m.metar %}
 <div>{% if d.flight_category %}<span class="tag {{ d.flight_category }}">{{ d.flight_category }}</span>{% endif %}
  <span class="muted">obs. {{ d.time | hm }}Z · {{ m.freshness.label }} · fonte {{ m.source }}</span></div>
 <pre>{{ d.raw }}</pre>
 <table>
  <tr><th>Vento</th><td>{% if d.wind %}{% if d.wind.calm %}calmo{% elif d.wind.variable %}variável{% else %}{{ '%03d' % d.wind.dir }}°{% endif %} {{ d.wind.speed_kt }} kt{% if d.wind.gust_kt %} rajadas {{ d.wind.gust_kt }} kt{% endif %}{% if d.wind.var_from %} (varia {{ d.wind.var_from }}°–{{ d.wind.var_to }}°){% endif %}{% else %}—{% endif %}</td></tr>
  <tr><th>Visibilidade</th><td>{{ d.visibility.text if d.visibility else '—' }}</td></tr>
  <tr><th>Tempo presente</th><td>{{ d.weather | map(attribute='text') | join(', ') or '—' }}</td></tr>
  <tr><th>Nuvens</th><td>{{ d.clouds | map(attribute='text') | join('; ') or ('CAVOK' if d.cavok else '—') }}</td></tr>
  <tr><th>Temp / orvalho</th><td>{{ d.temp_c if d.temp_c is not none else '—' }} °C / {{ d.dewpoint_c if d.dewpoint_c is not none else '—' }} °C</td></tr>
  <tr><th>QNH</th><td>{{ d.qnh_hpa or '—' }} hPa</td></tr>
  {% if d.trend %}<tr><th>Tendência</th><td>{{ d.trend }}</td></tr>{% endif %}
 </table>
 {% for a in d.alerts %}<div class="{{ 'err' if a.level=='error' else 'warn' }}">⚠ {{ a.text }}</div>{% endfor %}
{% else %}<div class="warn">METAR indisponível{% if m and m.error %} ({{ m.error }}){% endif %}.</div>{% endif %}
{% if taf and taf.available %}<div style="margin-top:6px"><b>TAF</b> <span class="muted">(aviationweather.gov · válido {{ taf.taf.valid_from | hm }}Z {{ (taf.taf.valid_from or '')[8:10] }}/{{ (taf.taf.valid_from or '')[5:7] }} a {{ taf.taf.valid_to | hm }}Z {{ (taf.taf.valid_to or '')[8:10] }}/{{ (taf.taf.valid_to or '')[5:7] }})</span>
 <pre>{% for s in taf.taf.segments %}{{ s }}
{% endfor %}</pre></div>{% elif taf %}<div class="muted">TAF: {{ taf.error or 'não disponível' }}</div>{% endif %}
</div>
{% endmacro %}
"""

LEG_TPL = ENV.from_string(METAR_MACRO + """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Briefing {{ b.leg.flight_number or 'POS' }} {{ b.leg.adep }}-{{ b.leg.ades }}</title><style>{{ css }}</style></head><body>
<div class="row" style="align-items:flex-end"><div><div class="muted">AeroScale · briefing · {{ b.schedule.name }}</div>
<h1>{{ b.leg.flight_number or 'POSICIONAMENTO' }} · {{ b.leg.adep }} → {{ b.leg.ades }}</h1>
<div class="muted">{{ b.leg.local_date }} · perna {{ b.position.index }}/{{ b.position.total }} · dado: {{ b.leg.origin_label }}</div></div>
<div style="margin-left:auto" class="muted">Gerado {{ b.generated_at | hm }}Z {{ b.generated_at[8:10] }}/{{ b.generated_at[5:7] }}</div></div>
<div class="row" style="margin-top:12px">
 <div class="box"><div class="muted">Partida</div><div class="big">{{ b.leg.adep }}</div>{{ b.airports.origin.name or '' }} – {{ b.airports.origin.city or '' }}<br>
  <b>{{ b.leg.dep_local[11:16] }}</b> {{ b.leg.dep_off }} ({{ b.leg.dep_utc | hm }}Z)</div>
 <div class="box"><div class="muted">Chegada</div><div class="big">{{ b.leg.ades }}</div>{{ b.airports.destination.name or '' }} – {{ b.airports.destination.city or '' }}<br>
  <b>{{ b.leg.arr_local[11:16] }}</b> {{ b.leg.arr_off }} ({{ b.leg.arr_utc | hm }}Z)</div>
 <div class="box"><div class="muted">Aeronave</div><div class="big">{{ b.leg.registration or '—' }}</div>
  {{ (b.aircraft.model if b.aircraft else None) or b.leg.type_icao or '' }} · RPL {{ b.leg.planned_type or '—' }}<br>Bloco estimado {{ b.leg.block_min | dur }} (EET {{ b.leg.eet_min | dur }})
  {% if b.aircraft and b.aircraft.is_demo %}<br><span class="warn">aeronave fictícia</span>{% endif %}</div>
</div>
{% if b.alerts %}<h2>Alertas</h2>{% for a in b.alerts %}<div class="{{ 'err' if a.level=='error' else 'warn' }}">⚠ {{ a.text }}</div>{% endfor %}{% endif %}
<h2>Meteorologia</h2><div class="row">{{ metar_box('Origem ' ~ b.leg.adep, b.weather.metar.origin, b.weather.taf.origin) }}{{ metar_box('Destino ' ~ b.leg.ades, b.weather.metar.destination, b.weather.taf.destination) }}</div>
{% for c in b.weather.comparison %}<div class="{{ 'warn' if c.level!='info' else 'muted' }}">• {{ c.text }}</div>{% endfor %}
{% if b.rpl %}<h2>Plano repetitivo (RPL)</h2><table><tr><th>Rota</th><td>{{ b.rpl.route }}</td></tr><tr><th>Nível / velocidade</th><td>FL{{ b.rpl.fl }} · {{ b.rpl.speed }}</td></tr>
<tr><th>EOBT / EET</th><td>{{ b.rpl.eobt }}Z · {{ b.rpl.eet }}</td></tr>{% for k, v in b.rpl.remarks.items() %}<tr><th>{{ k }}</th><td>{{ v }}</td></tr>{% endfor %}
<tr><th>Origem do dado</th><td>{{ b.rpl.file }}, linha {{ b.rpl.line }} (válido {{ b.rpl.valid }})</td></tr></table>{% endif %}
{% if b.simbrief %}<h2>Planejamento</h2><table><tr><th>Alternado</th><td>{{ b.simbrief.params.altn or 'SimBrief escolhe' }} <span class="muted">({{ b.simbrief.alternate.note }})</span></td></tr>
<tr><th>Observações (SimBrief)</th><td>{{ b.simbrief.params.extrarmk }}</td></tr>
<tr><th>SimBrief</th><td><a href="{{ b.simbrief.url }}">abrir despacho preenchido</a></td></tr>
<tr><th>IVAO Webeye</th><td><a href="https://webeye.ivao.aero/?callsign={{ b.leg.flight_number or '' }}">seguir {{ b.leg.flight_number or '' }}</a>{% if b.airports.origin.lat is defined and b.airports.origin.lat is not none %} · <a href="https://webeye.ivao.aero/?center={{ '%.4f' % b.airports.origin.lon }};{{ '%.4f' % b.airports.origin.lat }}&zoom=9">{{ b.leg.adep }} no mapa</a>{% endif %}</td></tr></table>
{% if b.airports.alternate %}<div class="row">{{ metar_box('Alternado ' ~ b.airports.alternate.icao, b.weather.metar.alternate, b.weather.taf.alternate) }}</div>{% endif %}{% endif %}
<h2>Sequência</h2><table><tr><th></th><th>Voo</th><th>Trecho</th><th>Partida</th><th>Chegada</th><th>Intervalo</th></tr>
{% if b.prev %}<tr><td>Anterior</td><td>{{ b.prev.flight_number or 'POS' }}</td><td>{{ b.prev.adep }}→{{ b.prev.ades }}</td><td>{{ b.prev.dep_local[11:16] }}</td><td>{{ b.prev.arr_local[11:16] }}</td><td>{{ b.prev.gap_next.label if b.prev.gap_next else '' }} {{ b.prev.gap_next.minutes | dur if b.prev.gap_next else '' }}</td></tr>{% endif %}
<tr><td><b>Este voo</b></td><td><b>{{ b.leg.flight_number or 'POS' }}</b></td><td>{{ b.leg.adep }}→{{ b.leg.ades }}</td><td>{{ b.leg.dep_local[11:16] }}</td><td>{{ b.leg.arr_local[11:16] }}</td><td>{{ b.leg.gap_next.label if b.leg.gap_next else '' }} {{ b.leg.gap_next.minutes | dur if b.leg.gap_next else '' }}</td></tr>
{% if b.next %}<tr><td>Próxima (escala)</td><td>{{ b.next.flight_number or 'POS' }}</td><td>{{ b.next.adep }}→{{ b.next.ades }}</td><td>{{ b.next.dep_local[11:16] }}</td><td>{{ b.next.arr_local[11:16] }}</td><td>{% if b.leg.model_next and b.leg.model_next.p is not none %}modelo: {{ b.leg.model_next.p | pct }} ({{ b.leg.model_next.rank }}º de {{ b.leg.model_next.n }}){% endif %}</td></tr>{% endif %}
</table>
<h2>Próxima perna prevista pelo modelo (não confirmada)</h2><table><tr><th>Voo</th><th>Trecho</th><th>Partida</th><th>Prob.</th><th>Confiança</th><th>Motivos</th></tr>
{% for c in b.prediction.candidates %}<tr><td>{{ c.ident }}</td><td>{{ c.adep }}→{{ c.ades }}</td><td>{{ c.dep_local[8:10] }}/{{ c.dep_local[5:7] }} {{ c.dep_local[11:16] }}</td><td>{{ c.p | pct }}</td><td>{{ c.confidence }}</td>
<td>{{ c.reasons | selectattr('weight', 'ne', 0) | map(attribute='text') | join('; ') }}</td></tr>{% else %}<tr><td colspan="6">Nenhum voo compatível nas 22 h seguintes.</td></tr>{% endfor %}</table>
{% if b.duty %}<h2>Jornada do dia</h2><div>Apresentação {{ b.duty.report_local }} · fim {{ b.duty.release_local }} · {{ b.duty.legs }} pouso(s) · jornada {{ (b.duty.duty_h*60) | dur }} de {{ b.duty.fdp_limit_h }} h · voo {{ (b.duty.block_h*60) | dur }} de {{ b.duty.flight_limit_h }} h <span class="muted">({{ b.crew_mode }})</span></div>{% endif %}
{% if b.aircraft and b.aircraft.config %}<h2>Configuração da aeronave</h2><div>{% for c in b.aircraft.config %}{{ c.label }}: <b>{{ c.value }}</b>{% if not loop.last %} · {% endif %}{% endfor %}</div>{% endif %}
<div class="foot">Simulação. Horários do RPL (CGNA); chegada = EOBT + EET + táxi estimado. METAR/TAF: aviationweather.gov (NOAA) ou NOAA tgftp – verifique a hora de observação. Previsões de sequência são estimativas estatísticas.</div>
</body></html>""")

DAY_TPL = ENV.from_string(METAR_MACRO + """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Briefing {{ b.schedule.name }} {{ b.day }}</title><style>{{ css }}</style></head><body>
<div class="muted">AeroScale · briefing do dia</div><h1>{{ b.schedule.name }} — {{ b.day }}</h1>
<div class="muted">{{ b.aircraft.registration if b.aircraft else 'sem matrícula' }} {{ ('· ' ~ b.aircraft.model) if b.aircraft and b.aircraft.model else '' }} · gerado {{ b.generated_at | hm }}Z</div>
<h2>Pernas</h2><table><tr><th>Voo</th><th>Trecho</th><th>Partida (local)</th><th>Chegada (local)</th><th>Bloco</th><th>Dado</th><th>Intervalo seguinte</th><th>SimBrief</th></tr>
{% for l in b.legs %}<tr><td>{{ l.flight_number or 'POS' }}</td><td>{{ l.adep }}→{{ l.ades }}</td><td>{{ l.dep_local[11:16] }} {{ l.dep_off }}</td><td>{{ l.arr_local[11:16] }} {{ l.arr_off }}</td><td>{{ l.block_min | dur }}</td><td>{{ l.origin_label }}</td><td>{{ l.gap_next.label if l.gap_next else '' }}{% if l.model_next and l.model_next.p is not none %} · modelo {{ l.model_next.p | pct }}{% endif %}</td><td>{% if l.simbrief and l.simbrief.url %}<a href="{{ l.simbrief.url }}">abrir</a>{% if l.simbrief.altn %} · altn {{ l.simbrief.altn }}{% endif %}{% endif %}</td></tr>{% endfor %}</table>
{% for d in b.duty %}<div style="margin-top:6px">Jornada: apresentação {{ d.report_local }}, fim {{ d.release_local }}, {{ (d.duty_h*60) | dur }} de {{ d.fdp_limit_h }} h, {{ d.legs }} pouso(s).</div>{% endfor %}
<h2>Meteorologia dos aeroportos do dia</h2><div class="row">{% for ap in b.airports %}{{ metar_box(ap.icao ~ ' ' ~ (ap.city or ''), b.weather.metar[ap.icao], b.weather.taf[ap.icao]) }}{% endfor %}</div>
{% if b.continuation %}<h2>Continuação prevista após a escala (não confirmada)</h2><table>{% for c in b.continuation %}<tr><td>{{ c.ident }}</td><td>{{ c.adep }}→{{ c.ades }}</td><td>{{ c.dep_local[11:16] }}</td><td>{{ c.p | pct }} · confiança {{ c.confidence }}</td></tr>{% endfor %}</table>{% endif %}
<div class="foot">Simulação. METAR/TAF: aviationweather.gov / NOAA. Previsões de sequência são estimativas estatísticas.</div>
</body></html>""")


def render_leg(b: dict) -> str:
    return LEG_TPL.render(b=b, css=CSS)


def render_day(b: dict) -> str:
    return DAY_TPL.render(b=b, css=CSS)
