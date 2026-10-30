"""Regras de tripulação (aviação regular brasileira, tripulação simples).

Fontes (válidas para GOL, LATAM e Azul, que operam sob o RBAC 121):
* Lei 13.475/2017 (Lei do Aeronauta)
  - art. 31: tripulação simples 8 h de voo e 4 pousos por jornada (+1 pouso com +2 h de repouso)
  - art. 33: 80 h de voo/mês em jato, 85 h em turboélice
  - art. 35 §3º/§4º: apresentação 30 min antes; fim da jornada 30 min após o corte (doméstico)
  - art. 36: jornada de 9 h (simples)
  - art. 41: 44 h semanais e 176 h mensais de trabalho
  - art. 42: no máximo 2 madrugadas consecutivas e 4 em 168 h (madrugada = 00:00 a 06:00)
  - art. 48: repouso de 12 h após jornada de até 12 h; 16 h até 15 h; 24 h acima de 15 h
  - art. 50/51: folga de 24 h na base, no máximo após o 6º dia; ≥ 10 folgas/mês, sendo
    ao menos 2 consecutivas com sábado e domingo
* RBAC 117 (ANAC), Apêndice B, Tabela B.1: jornada e tempo de voo máximos para tripulação
  simples aclimatada conforme o horário de apresentação e o número de etapas (operadores com
  gerenciamento de risco de fadiga, que é o caso das grandes empresas regulares). A partir do
  retorno de folga de 24 h, a jornada só começa às 10:00.

Os acordos coletivos específicos de cada empresa não são públicos; quando existirem regras
internas mais restritivas, ajuste os parâmetros na tela do gerador.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from .airports import get_tz

# Tabela B.1 do RBAC 117: (hora inicial, hora final) -> ([jornada por etapas], [voo por etapas])
# colunas de etapas: 1-2, 3-4, 5, 6, 7+
RBAC117_B1 = [
    ((6, 7), [11, 11, 10, 9, 9], [9, 9, 8, 8, 8]),
    ((7, 8), [13, 12, 11, 10, 9], [9.5, 9, 9, 8, 8]),
    ((8, 12), [13, 13, 12, 11, 10], [10, 9.5, 9, 9, 8]),
    ((12, 14), [12, 12, 11, 10, 9], [9.5, 9, 9, 8, 8]),
    ((14, 16), [11, 11, 10, 9, 9], [9, 9, 8, 8, 8]),
    ((16, 18), [10, 10, 9, 9, 9], [8, 8, 8, 8, 8]),
    ((18, 30), [9, 9, 9, 9, 9], [8, 8, 7, 7, 7]),  # 18:00–05:59
]

MODES = {
    "rbac117": "RBAC 117 – tabela B.1 (jornada conforme apresentação e etapas)",
    "lei": "Lei 13.475 estrita (9 h de jornada, 8 h de voo, 4 pousos)",
    "off": "Desligado",
}

TURBOPROP_FAMILIES = {"ATR", "C208"}

# Tempo de solo mínimo por categoria quando o RPL não tem amostras suficientes (estimativa).
TURN_FALLBACK = {"ATR": 25, "C208": 20, "E-JET": 30, "A320": 35, "B737": 35, "A330": 60, "A350": 60,
                 "B767": 60, "B777": 70, "B787": 60}


def _col(n_legs: int) -> int:
    return 0 if n_legs <= 2 else 1 if n_legs <= 4 else 2 if n_legs == 5 else 3 if n_legs == 6 else 4


def limits(report_local: datetime, n_legs: int, mode: str) -> dict:
    """Limites da jornada: horas de jornada, horas de voo e pousos máximos."""
    if mode == "lei":
        return {"fdp_h": 9.0, "flight_h": 8.0, "max_legs": 4, "source": "Lei 13.475 art. 31 e 36"}
    h = report_local.hour + report_local.minute / 60
    hh = h if h >= 6 else h + 24
    for (a, b), fdp, fl in RBAC117_B1:
        if a <= hh < b:
            c = _col(max(1, n_legs))
            return {"fdp_h": float(fdp[c]), "flight_h": float(fl[c]), "max_legs": 99,
                    "source": f"RBAC 117 tab. B.1 (apresentação {report_local:%H:%M}, {n_legs} etapa(s))"}
    return {"fdp_h": 9.0, "flight_h": 7.0, "max_legs": 99, "source": "RBAC 117 tab. B.1"}


def rest_after(duty_h: float) -> float:
    """Repouso mínimo (h) após a jornada – Lei 13.475 art. 48."""
    if duty_h <= 12:
        return 12.0
    if duty_h <= 15:
        return 16.0
    return 24.0


def touches_madrugada(start: datetime, end: datetime, tzname: str | None) -> bool:
    tz = get_tz(tzname) or timezone.utc
    s, e = start.astimezone(tz), end.astimezone(tz)
    d = s.date()
    while d <= e.date():
        a = datetime.combine(d, time(0, 0), tz)
        b = datetime.combine(d, time(6, 0), tz)
        if s < b and e > a:
            return True
        d += timedelta(days=1)
    return False


def monthly_block_limit_h(family: str | None) -> float:
    return 85.0 if family in TURBOPROP_FAMILIES else 80.0


def required_days_off(days_in_period_month: int, days_in_month: int, min_off: int) -> int:
    """Folgas exigidas proporcionalmente ao trecho do mês coberto pela escala."""
    return math.floor(min_off * days_in_period_month / days_in_month + 1e-9)


# ------------------------------------------------------------------ dias de folga
def plan_days_off(start: date, end: date, weekday_max: dict, unavailable: set, p: dict,
                  reserved: set | None = None) -> dict:
    """Define antes do planejamento quais dias são de folga.

    Ordem: 1) folgas fixas por dia da semana (0 pernas) e indisponibilidades;
    2) se as folgas regulamentares estão ligadas: fim de semana duplo por mês, máximo de
    dias seguidos de trabalho e mínimo mensal proporcional.
    Dias de reserva (reserved) são definidos antes: nunca viram folga e contam como dias de trabalho.
    Retorna {date: (tipo, motivo, max_pernas)} com tipo 'off', 'work' ou 'reserve'.
    """
    reserved = reserved or set()
    days = []
    d = start
    while d <= end:
        days.append(d)
        d += timedelta(days=1)
    plan: dict[date, list] = {}
    for d in days:
        wm = weekday_max.get(str(d.weekday()))
        if d in unavailable:
            plan[d] = ["off", "indisponível", 0]
        elif wm == 0:
            plan[d] = ["off", "folga fixa do dia da semana", 0]
        elif d in reserved:
            plan[d] = ["reserve", "reserva", wm if wm not in (None, "") else None]
        else:
            plan[d] = ["work", "", wm if wm not in (None, "") else None]
    if p.get("crew_days_off") and p.get("crew_mode", "off") != "off":
        max_consec = int(p.get("max_consecutive_days") or 6)
        min_off = int(p.get("days_off_min") or 10)
        months = defaultdict(list)
        for d in days:
            months[(d.year, d.month)].append(d)
        # 2a) um fim de semana duplo (sábado + domingo) por mês, se o período tiver um inteiro
        for (_y, _m), ds in months.items():
            sats = [d for d in ds if d.weekday() == 5 and d + timedelta(days=1) in plan
                    and plan[d][0] != "reserve" and plan[d + timedelta(days=1)][0] != "reserve"]
            if not sats or any(plan[s][0] == "off" and plan[s + timedelta(days=1)][0] == "off" for s in sats):
                continue
            if len(ds) >= 14 or len(days) >= 7:
                s = sats[len(sats) // 2] if len(sats) > 2 else sats[-1]
                for x in (s, s + timedelta(days=1)):
                    if plan[x][0] == "work":
                        plan[x] = ["off", "folga regulamentar (fim de semana do mês)", 0]
        # 2b) no máximo N dias seguidos de trabalho
        run = 0
        for d in days:
            if plan[d][0] == "off":
                run = 0
                continue
            run += 1
            if run > max_consec and plan[d][0] == "work":  # dia de reserva não vira folga: a folga vem logo depois
                plan[d] = ["off", f"folga regulamentar (após {max_consec} dias seguidos)", 0]
                run = 0
        # 2c) mínimo mensal proporcional, espalhando as folgas
        for (y, m), ds in months.items():
            import calendar
            need = required_days_off(len(ds), calendar.monthrange(y, m)[1], min_off)
            have = sum(1 for d in ds if plan[d][0] == "off")
            work = [d for d in ds if plan[d][0] == "work"]
            while have < need and work:
                offs = [d for d in ds if plan[d][0] == "off"]

                def dist(d):
                    return min([abs((d - o).days) for o in offs] + [99])
                # prefere dias longe de outras folgas; desempata grudando no fim de semana
                best = max(work, key=lambda d: (dist(d), d.weekday() in (5, 6), -d.toordinal()))
                plan[best] = ["off", "folga regulamentar (mínimo mensal)", 0]
                work.remove(best)
                have += 1
    return {d: tuple(v) for d, v in plan.items()}


# ------------------------------------------------------------------ análise de uma escala
def group_duties(legs: list[dict], split_hours: float = 10.0) -> list[list[dict]]:
    """Agrupa pernas em jornadas: intervalo ≥ 10 h (menor repouso possível) separa jornadas."""
    duties: list[list[dict]] = []
    for l in legs:
        if duties:
            prev = duties[-1][-1]
            gap = (l["_dep"] - prev["_arr"]).total_seconds() / 3600
            if gap < split_hours:
                duties[-1].append(l)
                continue
        duties.append([l])
    return duties


def analyze(legs: list[dict], p: dict, tz_of, base: str | None, family: str | None,
            period: tuple[date, date] | None = None, reserve_days: set | None = None) -> dict:
    """Confere a escala contra as regras e devolve jornadas, violações e resumo.

    legs precisam de: dep_utc, arr_utc, adep, ades, eet_min (ordem cronológica).
    tz_of(icao) -> nome IANA ou None.
    """
    mode = p.get("crew_mode", "off")
    rb = int(p.get("report_before") or 30)
    ra = int(p.get("release_after") or 30)
    from .scheduler import parse_utc  # import tardio para evitar ciclo
    ls = []
    for l in sorted(legs, key=lambda x: x["dep_utc"]):
        x = dict(l)
        x["_dep"], x["_arr"] = parse_utc(l["dep_utc"]), parse_utc(l["arr_utc"])
        ls.append(x)
    duties = group_duties(ls)
    out, viol = [], []
    madr_list: list[datetime] = []
    prev = None
    month_block = defaultdict(float)
    month_duty = defaultdict(float)
    week_duty = defaultdict(float)
    for i, dl in enumerate(duties):
        first, last = dl[0], dl[-1]
        tzn = tz_of(first["adep"])
        tz = get_tz(tzn) or timezone.utc
        report = first["_dep"] - timedelta(minutes=rb)
        release = last["_arr"] + timedelta(minutes=ra)
        rep_local = report.astimezone(tz)
        dur_h = (release - report).total_seconds() / 3600
        block_h = sum((x["_arr"] - x["_dep"]).total_seconds() for x in dl) / 3600
        lim = limits(rep_local, len(dl), mode if mode != "off" else "rbac117")
        madr = touches_madrugada(report, release, tzn)
        item = {"index": i + 1, "date": rep_local.date().isoformat(), "report_utc": report.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "release_utc": release.strftime("%Y-%m-%dT%H:%M:%SZ"), "report_local": rep_local.strftime("%H:%M"),
                "release_local": release.astimezone(get_tz(tz_of(last["ades"])) or timezone.utc).strftime("%H:%M"),
                "legs": len(dl), "duty_h": round(dur_h, 2), "block_h": round(block_h, 2),
                "fdp_limit_h": lim["fdp_h"], "flight_limit_h": lim["flight_h"],
                "max_legs": lim["max_legs"] if lim["max_legs"] < 99 else None, "limit_source": lim["source"],
                "madrugada": madr, "start": first["adep"], "end": last["ades"], "rest_before_h": None,
                "rest_required_h": None, "issues": []}
        if prev is not None:
            rest_h = (report - prev["_release"]).total_seconds() / 3600
            req = rest_after(prev["duty_h"])
            if prev.get("extra_leg"):
                req += 2
            item["rest_before_h"], item["rest_required_h"] = round(rest_h, 2), req
            if mode != "off" and rest_h + 1e-6 < req:
                item["issues"].append(("error", f"Repouso de {rest_h:.1f} h antes da jornada; mínimo {req:.0f} h "
                                                "(Lei 13.475 art. 48)."))
        if mode != "off":
            if dur_h > lim["fdp_h"] + 1e-6:
                item["issues"].append(("error", f"Jornada de {dur_h:.1f} h excede {lim['fdp_h']:g} h ({lim['source']})."))
            if block_h > lim["flight_h"] + 1e-6:
                item["issues"].append(("error", f"{block_h:.1f} h de voo excedem {lim['flight_h']:g} h ({lim['source']})."))
            if mode == "lei" and len(dl) > 4:
                if len(dl) == 5:
                    item["extra_leg"] = True
                    item["issues"].append(("warning", "5º pouso: permitido com repouso seguinte acrescido de 2 h "
                                                      "(Lei 13.475 art. 31 §1º)."))
                else:
                    item["issues"].append(("error", f"{len(dl)} pousos na jornada; máximo 4 (5 com +2 h de repouso)."))
            if madr and p.get("crew_madrugada", True):
                recent = [m for m in madr_list if (report - m).total_seconds() < 168 * 3600]
                if prev is not None and prev.get("madrugada") and len(out) >= 2 and out[-2].get("madrugada") and \
                        _consecutive_days(out[-2]["date"], prev["date"], item["date"]):
                    item["issues"].append(("error", "3ª madrugada consecutiva (máx. 2 – Lei 13.475 art. 42)."))
                if len(recent) >= 4:
                    item["issues"].append(("error", "5ª madrugada em 168 h (máx. 4 – Lei 13.475 art. 42)."))
            planned = set(p.get("planned_days_off") or [])
            after_off = ((date.fromisoformat(item["date"]) - timedelta(days=1)).isoformat() in planned) if planned \
                else (prev is not None and (date.fromisoformat(item["date"]) - date.fromisoformat(prev["date"])).days >= 2)
            if prev is not None and p.get("crew_days_off") and after_off and rep_local.time() < time(10, 0):
                item["issues"].append(("warning", "Primeira jornada após folga começa antes das 10:00 "
                                                  "(RBAC 117 Apêndice B (l)(6))."))
        if madr:
            madr_list.append(report)
        mk = rep_local.strftime("%Y-%m")
        wk = rep_local.date().isocalendar()[:2]
        month_block[mk] += block_h
        month_duty[mk] += dur_h
        week_duty[wk] += dur_h
        item["madrugada"] = madr
        item["_release"] = release
        prev = item
        out.append(item)

    # ---- regras de período
    summary = {"duties": len(out), "duty_h": round(sum(d["duty_h"] for d in out), 1),
               "block_h": round(sum(d["block_h"] for d in out), 1), "madrugadas": sum(1 for d in out if d["madrugada"]),
               "months": {}, "max_consecutive": 0, "days_off": None}
    if mode != "off":
        lim_m = monthly_block_limit_h(family)
        for mk, h in month_block.items():
            if h > lim_m + 1e-6:
                viol.append(("error", f"{mk}: {h:.1f} h de voo no mês; limite {lim_m:g} h (Lei 13.475 art. 33)."))
        for mk, h in month_duty.items():
            if h > 176 + 1e-6:
                viol.append(("error", f"{mk}: {h:.1f} h de jornada no mês; limite 176 h (art. 41)."))
        for wk, h in week_duty.items():
            if h > 44 + 1e-6:
                viol.append(("warning", f"Semana {wk[1]}/{wk[0]}: {h:.1f} h de jornada; limite 44 h semanais (art. 41)."))
    if period:
        reserve_days = set(reserve_days or ())
        work_days = {d["date"] for d in out} | reserve_days   # reserva conta como dia de trabalho
        d, run, best = period[0], 0, 0
        months = defaultdict(lambda: [0, 0])
        weekend_pair = defaultdict(bool)
        while d <= period[1]:
            ds = d.isoformat()
            months[d.strftime("%Y-%m")][0] += 1
            if ds in work_days:
                run += 1
                best = max(best, run)
            else:
                run = 0
                months[d.strftime("%Y-%m")][1] += 1
                if d.weekday() == 5 and (d + timedelta(days=1)).isoformat() not in work_days and \
                        d + timedelta(days=1) <= period[1]:
                    weekend_pair[d.strftime("%Y-%m")] = True
            d += timedelta(days=1)
        summary["max_consecutive"] = best
        import calendar
        for mk, (n, off) in months.items():
            y, m = map(int, mk.split("-"))
            need = required_days_off(n, calendar.monthrange(y, m)[1], int(p.get("days_off_min") or 10))
            summary["months"][mk] = {"days": n, "off": off, "required_off": need,
                                     "weekend_pair": weekend_pair[mk],
                                     "block_h": round(month_block.get(mk, 0), 1),
                                     "duty_h": round(month_duty.get(mk, 0), 1)}
            if mode != "off" and p.get("crew_days_off"):
                if off < need:
                    viol.append(("warning", f"{mk}: {off} folga(s) no período; mínimo proporcional {need} "
                                            "(10/mês – Lei 13.475 art. 51)."))
                if n >= 14 and not weekend_pair[mk]:
                    viol.append(("warning", f"{mk}: sem folga dupla de sábado e domingo (art. 51)."))
        if mode != "off" and p.get("crew_days_off") and best > int(p.get("max_consecutive_days") or 6):
            viol.append(("warning", f"{best} dias seguidos de trabalho{' (contando dias de reserva)' if reserve_days else ''};"
                                    " folga deve ocorrer após o 6º (art. 50)."))
        summary["reserve_days"] = len(reserve_days)
    for d in out:
        d.pop("_release", None)
        d.pop("extra_leg", None)
        d["issues"] = [{"level": a, "message": b} for a, b in d["issues"]]
    errors = sum(1 for d in out for i in d["issues"] if i["level"] == "error") + sum(1 for v in viol if v[0] == "error")
    warns = sum(1 for d in out for i in d["issues"] if i["level"] == "warning") + sum(1 for v in viol if v[0] == "warning")
    summary.update(errors=errors, warnings=warns, mode=mode, mode_label=MODES.get(mode, mode))
    return {"duties": out, "violations": [{"level": a, "message": b} for a, b in viol], "summary": summary}


def _consecutive_days(a: str, b: str, c: str) -> bool:
    da, db_, dc = date.fromisoformat(a), date.fromisoformat(b), date.fromisoformat(c)
    return (db_ - da).days == 1 and (dc - db_).days == 1
