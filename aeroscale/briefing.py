"""Painel de briefing: reúne escala, previsão de continuidade, meteorologia e jornada de um voo."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from . import catalog, predict, simbrief, weather
from .airports import offset_label, to_local
from .db import get_settings, row
from .rpl_service import get_index
from .scheduler import parse_utc, serialize_schedule


def _model_for(db, sched: dict):
    p = sched.get("params") or {}
    apmap = catalog.airport_map(db)
    ac_type = (sched.get("aircraft") or {}).get("icao_type") or p.get("icao_type_resolved")
    idx = get_index(db, sched["airline"], int(get_settings(db)["taxi_allowance_min"] or 0))
    return predict.RotationModel(idx, sched["airline"], ac_type, lambda icao: catalog.airport_tz(apmap, icao),
                                 bool(p.get("projection", True)),
                                 weights=predict.weights_for(get_settings(db), sched["airline"])), idx, apmap


def _occ_of_leg(idx, leg: dict) -> dict | None:
    if leg.get("flight_id"):
        o = idx.occurrence_by_ref(f"{leg['flight_id']}:{leg['dep_utc'][:10]}")
        if o:
            return o
    # perna manual/sugestão: cria um nó equivalente para consultar o modelo
    return {"ref": f"LEG:{leg['id']}", "ident": leg.get("flight_number"), "adep": leg["adep"], "ades": leg["ades"],
            "dep": parse_utc(leg["dep_utc"]), "arr": parse_utc(leg["arr_utc"]), "type_icao": leg.get("type_icao"),
            "origin": leg["data_origin"]}


def annotate_rotation(db, sched: dict) -> None:
    """Acrescenta a cada perna a probabilidade (modelo) de a perna seguinte da escala ser a continuação
    e a classificação do intervalo; acrescenta à escala a continuação prevista após a última perna."""
    legs = sched["legs"]
    if not legs:
        sched["continuation"] = []
        return
    model, idx, apmap = _model_for(db, sched)
    tz_of = lambda icao: catalog.airport_tz(apmap, icao)  # noqa: E731
    occs = [_occ_of_leg(idx, l) for l in legs]
    for i, l in enumerate(legs):
        l["model_next"] = None
        l["gap_next"] = None
        if i + 1 >= len(legs):
            continue
        a, b = legs[i], legs[i + 1]
        dep_b, arr_a = parse_utc(b["dep_utc"]), parse_utc(a["arr_utc"])
        if b["adep"] != a["ades"]:
            kind = "lacuna_dados"
        else:
            kind = predict.gap_kind(arr_a, dep_b, a["ades"], tz_of, model.min_turn)
        l["gap_next"] = {"kind": kind, "label": predict.GAP_LABEL.get(kind, kind),
                         "minutes": int((dep_b - arr_a).total_seconds() // 60)}
        cands = model.candidates(occs[i])
        p, rank = model.prob(occs[i], occs[i + 1]) if occs[i + 1] else (None, None)
        top = cands[0] if cands else None
        info = {"p": round(p, 4) if p is not None else None, "rank": rank, "n": len(cands),
                "top_ident": top["occ"]["ident"] if top else None, "top_p": round(top["p"], 4) if top else None}
        if p is not None:
            info["confidence"] = predict.confidence(p, len(cands), next(
                c["features"] for c in cands if c["occ"]["ref"] == occs[i + 1]["ref"]))[0]
        l["model_next"] = info
    last = occs[-1]
    end = parse_utc(legs[-1]["arr_utc"]) + timedelta(hours=26)
    sched["continuation"] = [_with_local(c, apmap) for c in model.chain(last, steps=4, until=end)]
    seq = predict.analyze_sequence([{"adep": l["adep"], "ades": l["ades"], "dep": parse_utc(l["dep_utc"]),
                                     "arr": parse_utc(l["arr_utc"]), "ident": l.get("flight_number")} for l in legs],
                                   tz_of, model.min_turn)
    sched["rotation"] = {"base": seq["base"], "base_confidence": seq["base_confidence"],
                         "overnights": seq["overnights"], "turnbacks": len(seq["turnbacks"]),
                         "paired_turnbacks": sum(1 for t in seq["turnbacks"] if t["paired_numbers"]),
                         "gap_counts": _count([g["kind"] for g in seq["gaps"]])}


def _count(items):
    out = {}
    for x in items:
        out[x] = out.get(x, 0) + 1
    return out


def _with_local(c: dict, apmap) -> dict:
    tz_d = catalog.airport_tz(apmap, c["adep"])
    tz_a = catalog.airport_tz(apmap, c["ades"])
    dl = to_local(parse_utc(c["dep_utc"]), tz_d)
    al = to_local(parse_utc(c["arr_utc"]), tz_a)
    return {**c, "dep_local": dl.strftime("%Y-%m-%dT%H:%M"), "arr_local": al.strftime("%Y-%m-%dT%H:%M"),
            "dep_off": offset_label(dl) if tz_d else "UTC", "arr_off": offset_label(al) if tz_a else "UTC",
            "adep_city": (apmap.get(c["adep"]) or {}).get("city"), "ades_city": (apmap.get(c["ades"]) or {}).get("city")}


def _rpl_details(db, leg: dict) -> dict | None:
    if not leg.get("flight_id"):
        return None
    f = row(db.execute("SELECT f.*, i.filename FROM rpl_flights f JOIN rpl_imports i ON i.id=f.import_id WHERE f.id=?",
                       (leg["flight_id"],)))
    if not f:
        return None
    rem = json.loads(f["remarks_json"] or "{}")
    return {"ident": f["ident"], "type": f"{f['type_icao']}/{f['wake']}", "eobt": f["eobt"], "eet": f["eet"],
            "speed": f["speed"], "fl": f["fl"], "route": f["route"], "remarks": rem, "file": f["filename"],
            "line": f["line_no"], "valid": f"{f['valid_from']} a {f['valid_to']}", "days": f["days"]}


def _aircraft_info(db, aid) -> dict | None:
    if not aid:
        return None
    a = row(db.execute("SELECT a.*, m.name AS model_name, m.icao_type, m.family FROM aircraft a LEFT JOIN"
                       " aircraft_models m ON m.id=a.model_id WHERE a.id=?", (aid,)))
    if not a:
        return None
    cfg = [dict(r) for r in db.execute(
        "SELECT f.label, c.value FROM aircraft_config c JOIN config_fields f ON f.id=c.field_id WHERE c.aircraft_id=?"
        " AND f.active=1 ORDER BY f.sort, f.label", (aid,))]
    return {"registration": a["registration"], "model": a["model_name"], "icao_type": a["icao_type"],
            "family": a["family"], "is_demo": bool(a["is_demo"]), "msn": a["msn"], "config": cfg,
            "blocked_airports": a["blocked_airports"]}


def leg_briefing(db, leg_id: int, force_wx=False) -> dict:
    l0 = row(db.execute("SELECT schedule_id FROM schedule_legs WHERE id=?", (leg_id,)))
    if not l0:
        raise LookupError("Perna não encontrada.")
    sched = serialize_schedule(db, l0["schedule_id"])
    annotate_rotation(db, sched)
    legs = sched["legs"]
    i = next(k for k, x in enumerate(legs) if x["id"] == leg_id)
    leg = legs[i]
    prev = legs[i - 1] if i > 0 else None
    nxt = legs[i + 1] if i + 1 < len(legs) else None
    model, idx, apmap = _model_for(db, sched)
    occ = _occ_of_leg(idx, leg)
    cands = model.candidates(occ)
    preds = [_with_local(predict.describe(c, len(cands)), apmap) for c in cands[:5]]
    duty = next((d for d in sched["crew"]["duties"] if d["date"] == leg["local_date"] or
                 (d["report_utc"] <= leg["dep_utc"] <= d["release_utc"])), None)
    s = get_settings(db)
    ac_info = _aircraft_info(db, leg.get("aircraft_id"))
    sb = simbrief.build(db, leg, ac_info, {"settings": s, "apmap": apmap})
    altn = sb["params"].get("altn")
    wx = _weather(db, [x for x in (leg["adep"], leg["ades"], altn) if x], int(s.get("metar_ttl_min") or 10), force_wx)
    mo, md = wx["metar"].get(leg["adep"]), wx["metar"].get(leg["ades"])
    ma = wx["metar"].get(altn) if altn else None
    alerts = []
    for ap, m in ((leg["adep"], mo), (leg["ades"], md)):
        if not m or not m["available"]:
            alerts.append({"level": "warning", "text": f"METAR de {ap} indisponível ({(m or {}).get('error') or 'sem dados'})."})
        elif m["freshness"]["status"] != "atual":
            alerts.append({"level": "warning", "text": f"METAR de {ap} {m['freshness']['label']}."})
        if m and m.get("error") and m["available"]:
            alerts.append({"level": "info", "text": f"{ap}: última consulta falhou ({m['error']}); exibindo cache."})
    dep_in = (parse_utc(leg["dep_utc"]) - datetime.now(timezone.utc)).total_seconds() / 3600
    if dep_in > 3 or dep_in < -6:
        alerts.append({"level": "info", "text": "O voo não está nas próximas 3 h: o METAR mostra a condição ATUAL, não a do "
                                                "horário do voo. Consulte o TAF."})
    return {
        "generated_at": weather.iso(weather.now_utc()),
        "schedule": {"id": sched["id"], "name": sched["name"], "airline": sched["airline"], "kind": sched["kind"],
                     "start_date": sched["start_date"], "end_date": sched["end_date"]},
        "leg": leg, "prev": prev, "next": nxt, "position": {"index": i + 1, "total": len(legs)},
        "aircraft": ac_info,
        "airports": {"origin": apmap.get(leg["adep"]) or {"icao": leg["adep"]},
                     "destination": apmap.get(leg["ades"]) or {"icao": leg["ades"]},
                     "alternate": (apmap.get(altn) or {"icao": altn}) if altn else None},
        "simbrief": sb,
        "rpl": _rpl_details(db, leg),
        "prediction": {"candidates": preds, "n": len(cands),
                       "schedule_next": leg.get("model_next"),
                       "note": "Previsões do modelo de rodízio (não confirmadas). Probabilidade relativa entre os voos "
                               "do RPL que partem do destino nas 22 h seguintes."},
        "duty": duty, "crew_mode": sched["crew"]["summary"]["mode_label"],
        "weather": {"metar": {"origin": mo, "destination": md, "alternate": ma},
                    "taf": {"origin": wx["taf"].get(leg["adep"]), "destination": wx["taf"].get(leg["ades"]),
                            "alternate": wx["taf"].get(altn) if altn else None},
                    "comparison": weather.compare((mo or {}).get("metar"), (md or {}).get("metar"))},
        "alerts": alerts,
    }


def _weather(db, icaos, ttl, force):
    mets = weather.get_metars(db, icaos, ttl, force)
    tafs = weather.get_tafs(db, icaos, 30, force)
    return {"metar": {m["icao"]: m for m in mets}, "taf": {t["icao"]: t for t in tafs}}


def schedule_briefing(db, sid: int, day: str | None = None, force_wx=False) -> dict:
    sched = serialize_schedule(db, sid)
    annotate_rotation(db, sched)
    dates = sorted({l["local_date"] for l in sched["legs"]})
    if not dates:
        raise ValueError("Escala sem pernas.")
    if not day:
        today = date.today().isoformat()
        day = next((d for d in dates if d >= today), dates[0])
    simbrief.annotate(db, sched)
    legs = [l for l in sched["legs"] if l["local_date"] == day]
    aps = list(dict.fromkeys([x for l in legs for x in (l["adep"], l["ades"])]))
    s = get_settings(db)
    wx = _weather(db, aps, int(s.get("metar_ttl_min") or 10), force_wx)
    duty = [d for d in sched["crew"]["duties"] if d["date"] == day]
    apmap = catalog.airport_map(db)
    is_last_day = day == dates[-1]
    return {"generated_at": weather.iso(weather.now_utc()),
            "schedule": {"id": sched["id"], "name": sched["name"], "airline": sched["airline"]},
            "aircraft": _aircraft_info(db, sched["aircraft_id"]), "day": day, "dates": dates, "legs": legs,
            "airports": [apmap.get(a) or {"icao": a} for a in aps],
            "weather": {"metar": wx["metar"], "taf": wx["taf"]}, "duty": duty,
            "continuation": sched.get("continuation") if is_last_day else [],
            "rotation": sched.get("rotation")}
