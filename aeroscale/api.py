"""API REST (JSON) consumida pela interface."""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from functools import wraps

from flask import Blueprint, Response, current_app, jsonify, redirect, request, session

from . import reserve as reserve_mod
from . import adsb, backup, briefing, briefing_html, catalog, fleet, predict, scheduler, simbrief, weather
from .airports import offset_label, to_local
from .db import get_db, get_settings, now_iso, row, rows, set_settings
from .gcal import GoogleCalendar, GoogleError
from .rpl_service import ImportError_, get_index, import_rpl

bp = Blueprint("api", __name__, url_prefix="/api")


class ApiError(Exception):
    def __init__(self, message, status=400, data=None):
        super().__init__(message)
        self.status = status
        self.data = data or {}


def api(fn):
    """Envolve a rota: commit em sucesso, rollback e JSON de erro em falha."""
    @wraps(fn)
    def wrapper(*a, **kw):
        db = get_db()
        try:
            out = fn(*a, **kw)
            db.commit()
            if isinstance(out, Response):
                return out
            return jsonify(out if out is not None else {"ok": True})
        except ApiError as e:
            db.rollback()
            return jsonify({"error": str(e), **e.data}), e.status
        except ImportError_ as e:
            db.rollback()
            return jsonify({"error": str(e), **e.data}), 409 if "duplicate_of" in e.data else 400
        except (ValueError, scheduler.PlanError) as e:
            db.rollback()
            return jsonify({"error": str(e)}), 400
        except LookupError as e:
            db.rollback()
            return jsonify({"error": str(e)}), 404
        except GoogleError as e:
            db.rollback()
            return jsonify({"error": str(e), "google_status": e.status}), 502 if e.status != 401 else 401
        except Exception as e:  # pragma: no cover - erro inesperado
            db.rollback()
            current_app.logger.exception("Erro inesperado")
            return jsonify({"error": f"Erro inesperado: {e.__class__.__name__}: {e}"}), 500
    return wrapper


def clean_weekday_max(v) -> dict:
    out = {}
    for k, x in (v or {}).items():
        if str(k) not in [str(i) for i in range(7)]:
            raise ValueError("Dia da semana inválido.")
        if x in (None, "", "padrao"):
            continue
        try:
            n = int(x)
        except (TypeError, ValueError):
            raise ValueError("Máximo de pernas por dia deve ser um número (0 = folga).")
        if not 0 <= n <= 12:
            raise ValueError("Máximo de pernas por dia entre 0 e 12.")
        out[str(k)] = n
    return out


def body() -> dict:
    return request.get_json(silent=True) or {}


def gcal() -> GoogleCalendar:
    return GoogleCalendar(current_app.config["DATA_DIR"])


def csv_response(text: str, filename: str, mime="text/csv; charset=utf-8") -> Response:
    return Response(text, mimetype=mime.split(";")[0], headers={
        "Content-Disposition": f'attachment; filename="{filename}"', "Content-Type": mime})


def leg_brief(apmap, l: dict) -> dict:
    dep, arr = scheduler.parse_utc(l["dep_utc"]), scheduler.parse_utc(l["arr_utc"])
    tzd, tza = catalog.airport_tz(apmap, l["adep"]), catalog.airport_tz(apmap, l["ades"])
    ld, la = to_local(dep, tzd), to_local(arr, tza)
    return {**l, "dep_local": ld.strftime("%Y-%m-%dT%H:%M"), "arr_local": la.strftime("%Y-%m-%dT%H:%M"),
            "dep_off": offset_label(ld) if tzd else "UTC", "arr_off": offset_label(la) if tza else "UTC",
            "local_date": ld.date().isoformat(), "block_min": int((arr - dep).total_seconds() // 60),
            "adep_city": (apmap.get(l["adep"]) or {}).get("city"), "ades_city": (apmap.get(l["ades"]) or {}).get("city")}


# ================================================================== meta / painel
@bp.get("/meta")
@api
def meta():
    db = get_db()
    apmap = catalog.airport_map(db)
    cov = {r["airline"]: r for r in rows(db.execute(
        "SELECT airline, MIN(valid_from) vf, MAX(valid_to) vt, SUM(record_count) n FROM rpl_imports WHERE active=1"
        " GROUP BY airline"))}
    als = catalog.airlines(db)
    for a in als:
        c = cov.get(a["code"])
        a["coverage"] = {"from": c["vf"], "to": c["vt"], "records": c["n"]} if c else None
        a["types"] = [r["type_icao"] for r in db.execute(
            "SELECT DISTINCT f.type_icao FROM rpl_flights f JOIN rpl_imports i ON i.id=f.import_id"
            " WHERE i.active=1 AND f.airline=? ORDER BY 1", (a["code"],))]
    return {
        "airlines": als, "settings": get_settings(db), "airports": sorted(apmap.values(), key=lambda x: x["icao"]),
        "models": fleet.list_models(db), "fields": fleet.fields_for(db, include_inactive=True),
        "families": sorted({f for (_, f) in catalog.TYPE_INFO.values()}),
        "type_info": {k: {"name": v[0], "family": v[1]} for k, v in catalog.TYPE_INFO.items()},
        "open_flags": db.execute("SELECT COUNT(*) c FROM review_flags WHERE resolved=0").fetchone()["c"],
        "google": gcal().status(), "now_utc": now_iso(),
    }


@bp.get("/dashboard")
@api
def dashboard():
    db = get_db()
    apmap = catalog.airport_map(db)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    upcoming = rows(db.execute(
        "SELECT l.*, s.name AS schedule_name FROM schedule_legs l JOIN schedules s ON s.id=l.schedule_id"
        " WHERE l.arr_utc>=? ORDER BY l.dep_utc LIMIT 8", (now,)))
    schedules = rows(db.execute(
        "SELECT s.id, s.name, s.airline, s.kind, s.start_date, s.end_date, s.updated_at, a.registration,"
        " (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id) legs,"
        " (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id AND l.data_origin='REAL') real_legs,"
        " (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id AND l.data_origin='PROJETADO') proj_legs,"
        " (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id AND l.data_origin IN ('SUGESTAO','MANUAL'))"
        " other_legs FROM schedules s LEFT JOIN aircraft a ON a.id=s.aircraft_id ORDER BY s.updated_at DESC LIMIT 6"))
    stats = {
        "flights": rows(db.execute(
            "SELECT f.airline, COUNT(*) n, COUNT(DISTINCT f.ident) idents FROM rpl_flights f JOIN rpl_imports i"
            " ON i.id=f.import_id WHERE i.active=1 GROUP BY f.airline")),
        "aircraft": rows(db.execute("SELECT airline, COUNT(*) n, SUM(is_demo) demo FROM aircraft WHERE active=1"
                                    " GROUP BY airline")),
        "schedules": db.execute("SELECT COUNT(*) c FROM schedules").fetchone()["c"],
        "legs": db.execute("SELECT COUNT(*) c FROM schedule_legs").fetchone()["c"],
        "open_flags": db.execute("SELECT COUNT(*) c FROM review_flags WHERE resolved=0").fetchone()["c"],
        "imports": db.execute("SELECT COUNT(*) c FROM rpl_imports").fetchone()["c"],
    }
    return {"upcoming": [leg_brief(apmap, l) for l in upcoming], "schedules": schedules, "stats": stats,
            "now_utc": now}


@bp.get("/calendar")
@api
def calendar():
    db = get_db()
    apmap = catalog.airport_map(db)
    a = request.args
    d1 = a.get("from") or date.today().isoformat()
    d2 = a.get("to") or d1
    q = ("SELECT l.*, s.name AS schedule_name FROM schedule_legs l JOIN schedules s ON s.id=l.schedule_id"
         " WHERE l.dep_utc>=? AND l.dep_utc<=?")
    args = [(date.fromisoformat(d1) - timedelta(days=1)).isoformat(), (date.fromisoformat(d2) + timedelta(days=1))
            .isoformat() + "T23:59:59Z"]
    for k, col in (("airline", "l.airline"), ("aircraft_id", "l.aircraft_id"), ("schedule_id", "l.schedule_id")):
        if a.get(k):
            q += f" AND {col}=?"
            args.append(a[k])
    items = [leg_brief(apmap, l) for l in rows(db.execute(q + " ORDER BY l.dep_utc", args))]
    rq = ("SELECT r.*, s.name AS schedule_name FROM schedule_reserves r JOIN schedules s ON s.id=r.schedule_id"
          " WHERE r.end_date>=? AND r.start_date<=?")
    rargs = [d1, d2]
    for k, col in (("airline", "s.airline"), ("aircraft_id", "s.aircraft_id"), ("schedule_id", "r.schedule_id")):
        if a.get(k):
            rq += f" AND {col}=?"
            rargs.append(a[k])
    res = []
    for r in rows(db.execute(rq + " ORDER BY r.start_date", rargs)):
        name = r["schedule_name"]
        for k in ("start_date", "end_date", "act_start"):
            r[k] = date.fromisoformat(r[k]) if r[k] else None
        r["activated"] = bool(r["activated"])
        res.append({**reserve_mod.serialize(r, apmap, []), "schedule_name": name, "schedule_id": r["schedule_id"]})
    return {"legs": [i for i in items if d1 <= i["local_date"] <= d2], "reserves": res}


@bp.get("/search")
@api
def search():
    db = get_db()
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return {"results": []}
    up = q.upper()
    res = []
    for r in db.execute(
            "SELECT f.ident, f.airline, MIN(f.adep) adep, COUNT(*) n FROM rpl_flights f JOIN rpl_imports i"
            " ON i.id=f.import_id WHERE i.active=1 AND (f.ident LIKE ? OR f.flight_number=?) GROUP BY f.ident LIMIT 8",
            (f"%{up}%", up.lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ"))):
        res.append({"kind": "voo", "label": r["ident"], "sub": f"{r['n']} registro(s) no RPL", "target":
                    f"#/voos?q={r['ident']}"})
    for r in db.execute("SELECT a.id, a.registration, a.airline, m.icao_type FROM aircraft a LEFT JOIN aircraft_models m"
                        " ON m.id=a.model_id WHERE a.registration LIKE ? LIMIT 8", (f"%{up}%",)):
        res.append({"kind": "aeronave", "label": r["registration"], "sub": f"{r['airline']} · {r['icao_type'] or '?'}",
                    "target": f"#/frota?open={r['id']}"})
    for r in db.execute("SELECT id, name FROM schedules WHERE name LIKE ? ORDER BY updated_at DESC LIMIT 6",
                        (f"%{q}%",)):
        res.append({"kind": "escala", "label": r["name"], "sub": "Escala", "target": f"#/escalas/{r['id']}"})
    for ap in catalog.airport_map(db).values():
        if up in (ap["icao"], ap.get("iata") or "") or (len(q) >= 3 and q.lower() in (ap.get("city") or "").lower()):
            res.append({"kind": "aeroporto", "label": f"{ap['icao']} {ap.get('iata') or ''}".strip(),
                        "sub": f"{ap.get('city') or ''} – {ap.get('name') or ''}", "target": f"#/voos?adep={ap['icao']}"})
        if len(res) > 30:
            break
    return {"results": res[:30]}


# ================================================================== configurações
@bp.put("/settings")
@api
def put_settings():
    data = body()
    allowed = {"display_tz", "taxi_allowance_min", "min_turn_min", "max_turn_min", "min_rest_min", "day_start",
               "day_end", "legs_min", "legs_max", "projection_enabled", "avoid_used_flights", "google_calendar_id",
               "google_redirect_uri", "turn_mode", "crew_mode", "crew_days_off", "crew_folga_base", "crew_madrugada",
               "crew_monthly", "days_off_min", "max_consecutive_days", "report_before_min", "release_after_min",
               "weekday_max", "metar_ttl_min", "metar_autorefresh_min", "model_realism", "anomaly_repeat_pct",
               "simbrief_units", "simbrief_rmk", "simbrief_alternates", "reserve_enabled", "reserve_per_month",
               "reserve_min_days", "reserve_max_days", "reserve_base_pct", "reserve_activation_pct",
               "reserve_activation_max_days", "rpl_autoimport"}
    clean = {}
    for k, v in data.items():
        if k not in allowed:
            continue
        if k == "weekday_max":
            v = clean_weekday_max(v)
        elif k in ("reserve_enabled", "rpl_autoimport"):
            v = bool(v)
        elif k in ("reserve_per_month", "reserve_min_days", "reserve_max_days", "reserve_base_pct",
                   "reserve_activation_pct", "reserve_activation_max_days"):
            lo, hi = {"reserve_per_month": (0, 4), "reserve_min_days": (3, 9), "reserve_max_days": (3, 9),
                      "reserve_activation_max_days": (1, 9)}.get(k, (0, 100))
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise ValueError(f"Valor inválido em {k}.")
            if not lo <= v <= hi:
                raise ValueError(f"{k} deve ficar entre {lo} e {hi}.")
        elif k == "anomaly_repeat_pct":
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise ValueError("Chance de anormalidade inválida.")
            if not 0 <= v <= 100:
                raise ValueError("Chance de anormalidade deve ficar entre 0 e 100%.")
        elif k == "simbrief_units":
            v = str(v).upper()
            if v not in ("KGS", "LBS"):
                raise ValueError("Unidade do SimBrief deve ser KGS ou LBS.")
        elif k == "simbrief_rmk":
            v = re.sub(r"[^A-Z0-9 /.-]", "", str(v).upper())[:120].strip()
        elif k == "simbrief_alternates":
            v = simbrief.clean_alternates(v)
        elif k in ("turn_mode", "crew_mode", "display_tz", "google_calendar_id", "google_redirect_uri", "day_start",
                   "day_end"):
            v = str(v)
            if k == "turn_mode" and v not in ("auto", "fixed"):
                raise ValueError("Modo de tempo de solo inválido.")
            if k == "crew_mode" and v not in ("rbac117", "lei", "off"):
                raise ValueError("Perfil de regras inválido.")
        elif k.startswith("crew_") or k in ("projection_enabled", "avoid_used_flights", "model_realism"):
            v = bool(v)
        elif k.endswith("_min") or k in ("legs_min", "legs_max", "days_off_min", "max_consecutive_days"):
            if k in ("metar_ttl_min",) and int(v or 0) < 1:
                raise ValueError("O cache do METAR deve ser de pelo menos 1 minuto.")
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise ValueError(f"Valor numérico inválido para {k}.")
            if v < 0 or v > 2880:
                raise ValueError(f"{k} fora do intervalo permitido.")
        if k in ("day_start", "day_end"):
            try:
                h, m = map(int, str(v).split(":"))
                assert 0 <= h < 24 and 0 <= m < 60
            except Exception:
                raise ValueError("Horário deve estar no formato HH:MM.")
        clean[k] = v
    s = {**get_settings(get_db()), **clean}
    if s["max_turn_min"] < s["min_turn_min"]:
        raise ValueError("Tempo de solo máximo menor que o mínimo.")
    if s["legs_max"] < s["legs_min"]:
        raise ValueError("Máximo de pernas por dia menor que o mínimo.")
    if int(s.get("reserve_min_days", 3)) > int(s.get("reserve_max_days", 9)):
        raise ValueError("Duração mínima da reserva maior que a máxima.")
    set_settings(get_db(), clean)
    return get_settings(get_db())


@bp.post("/airlines")
@api
def create_airline():
    d = body()
    code = (d.get("code") or "").strip().upper()
    if not (len(code) == 3 and code.isalnum()):
        raise ValueError("Designador ICAO da companhia deve ter 3 caracteres (ex.: AZU).")
    if not (d.get("name") or "").strip():
        raise ValueError("Informe o nome da companhia.")
    db = get_db()
    if db.execute("SELECT 1 FROM airlines WHERE code=?", (code,)).fetchone():
        raise ValueError("Companhia já cadastrada.")
    db.execute("INSERT INTO airlines(code, iata, name, color, created_at) VALUES (?,?,?,?,?)",
               (code, (d.get("iata") or "").upper()[:2], d["name"].strip(), d.get("color") or "#9AA7B5", now_iso()))
    return {"code": code}


@bp.put("/airlines/<code>")
@api
def update_airline(code):
    d = body()
    db = get_db()
    a = row(db.execute("SELECT * FROM airlines WHERE code=?", (code,)))
    if not a:
        raise LookupError("Companhia não encontrada.")
    db.execute("UPDATE airlines SET name=?, iata=?, color=?, active=?, needs_review=0 WHERE code=?",
               ((d.get("name") or a["name"]).strip(), (d.get("iata", a["iata"]) or "").upper()[:2],
                d.get("color") or a["color"], 1 if d.get("active", a["active"]) else 0, code))
    return {"code": code}


@bp.post("/airports")
@api
def save_airport():
    db = get_db()
    r = catalog.upsert_airport(db, body())
    db.execute("UPDATE review_flags SET resolved=1, resolution='aeroporto cadastrado', resolved_at=?"
               " WHERE entity='airport' AND resolved=0 AND data LIKE ?", (now_iso(), f'%"{r["icao"]}"%'))
    return r


@bp.delete("/airports/<icao>")
@api
def delete_airport(icao):
    get_db().execute("DELETE FROM airports WHERE icao=?", (icao.upper(),))
    return {"ok": True}


# ================================================================== RPL
@bp.post("/rpl/import")
@api
def rpl_import():
    files = request.files.getlist("files") or request.files.getlist("file")
    if not files:
        raise ValueError("Selecione ao menos um arquivo TXT.")
    replace = request.form.get("replace", "1") == "1"
    force = request.form.get("force") == "1"
    db = get_db()
    results = []
    for f in files:
        data = f.read()
        try:
            results.append({"filename": f.filename, "ok": True,
                            **import_rpl(db, data, f.filename, current_app.config["STORAGE_DIR"], replace, force)})
            db.commit()
        except ImportError_ as e:
            db.rollback()
            results.append({"filename": f.filename, "ok": False, "error": str(e), **e.data})
    return {"results": results}


@bp.post("/rpl/import-samples")
@api
def rpl_import_samples():
    """Importa os RPL da pasta rpl/ do AeroScale (os já importados aparecem como pulados)."""
    from .rpl_service import folder_files, import_folder
    folder = current_app.config["RPL_DIR"]
    if not folder_files(folder):
        raise ValueError(f"A pasta {folder} não tem arquivos .txt. Coloque nela os RPL (ex.: AZU.txt, GLO.txt, TAM.txt).")
    res = import_folder(get_db(), folder, current_app.config["STORAGE_DIR"])
    for x in res:
        if x.get("skipped"):
            x.update(ok=False, error="Este arquivo já foi importado.")
    return {"results": res, "folder": folder}


@bp.get("/rpl/imports")
@api
def rpl_imports():
    items = rows(get_db().execute("SELECT * FROM rpl_imports ORDER BY id DESC"))
    for i in items:
        i["file_issues"] = json.loads(i["file_issues"] or "[]")
        i["layout"] = json.loads(i["layout"] or "{}")
    return {"imports": items}


@bp.get("/rpl/imports/<int:iid>/original")
def rpl_original(iid):
    r = row(get_db().execute("SELECT * FROM rpl_imports WHERE id=?", (iid,)))
    path = backup.resolve_stored(current_app.config, r["stored_path"]) if r else None
    if not path:
        return jsonify({"error": "Arquivo original não encontrado."}), 404
    with open(path, "rb") as fh:
        return Response(fh.read(), mimetype="text/plain", headers={
            "Content-Disposition": f'attachment; filename="{r["filename"]}"'})


@bp.post("/rpl/imports/<int:iid>/active")
@api
def rpl_toggle(iid):
    act = 1 if body().get("active") else 0
    db = get_db()
    if not db.execute("SELECT 1 FROM rpl_imports WHERE id=?", (iid,)).fetchone():
        raise LookupError("Importação não encontrada.")
    db.execute("UPDATE rpl_imports SET active=? WHERE id=?", (act, iid))
    return {"id": iid, "active": act}


@bp.delete("/rpl/imports/<int:iid>")
@api
def rpl_delete(iid):
    db = get_db()
    r = row(db.execute("SELECT * FROM rpl_imports WHERE id=?", (iid,)))
    if not r:
        raise LookupError("Importação não encontrada.")
    used = db.execute("SELECT COUNT(*) c FROM schedule_legs WHERE flight_id IN (SELECT id FROM rpl_flights WHERE"
                      " import_id=?)", (iid,)).fetchone()["c"]
    db.execute("DELETE FROM rpl_flights WHERE import_id=?", (iid,))
    db.execute("DELETE FROM rpl_imports WHERE id=?", (iid,))
    # apagado de propósito: a importação automática da pasta rpl/ não traz esse arquivo de volta
    m = db.execute("SELECT value FROM meta WHERE key='rpl_folder_skip'").fetchone()
    skip = set(json.loads(m["value"])) if m else set()
    skip.add(r["sha256"])
    db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('rpl_folder_skip', ?)", (json.dumps(sorted(skip)),))
    sp = backup.resolve_stored(current_app.config, r["stored_path"])
    if sp:
        os.remove(sp)
    return {"deleted": iid, "legs_affected": used}


@bp.get("/rpl/flights")
@api
def rpl_flights():
    a = request.args
    db = get_db()
    q = " FROM rpl_flights f JOIN rpl_imports i ON i.id=f.import_id WHERE 1=1"
    p: list = []
    if a.get("import_id"):
        q += " AND f.import_id=?"
        p.append(int(a["import_id"]))
    else:
        q += " AND i.active=1"
    for k, col in (("airline", "f.airline"), ("adep", "f.adep"), ("ades", "f.ades"), ("type", "f.type_icao"),
                   ("status", "f.status")):
        if a.get(k):
            q += f" AND {col}=?"
            p.append(a[k].upper() if k != "status" else a[k])
    if a.get("q"):
        q += " AND (f.ident LIKE ? OR f.route LIKE ?)"
        p += [f"%{a['q'].upper()}%", f"%{a['q'].upper()}%"]
    if a.get("date"):
        try:
            d = date.fromisoformat(a["date"])
        except ValueError:
            raise ValueError("Data inválida.")
        q += f" AND f.valid_from<=? AND f.valid_to>=? AND substr(f.days,{d.weekday() + 1},1)<>'0'"
        p += [d.isoformat(), d.isoformat()]
    total = db.execute("SELECT COUNT(*) c" + q, p).fetchone()["c"]
    limit = min(int(a.get("limit", 100)), 500)
    offset = int(a.get("offset", 0))
    order = " ORDER BY f.adep, f.eobt, f.ident" if a.get("date") else " ORDER BY f.ident, f.valid_from, f.adep"
    items = rows(db.execute("SELECT f.*, i.filename, i.active AS import_active" + q + order + " LIMIT ? OFFSET ?",
                            p + [limit, offset]))
    for it in items:
        it["issues"] = json.loads(it["issues"] or "[]")
        it["remarks_json"] = json.loads(it["remarks_json"] or "{}")
    return {"total": total, "items": items, "limit": limit, "offset": offset}


@bp.get("/rpl/occurrences")
@api
def rpl_occurrences():
    a = request.args
    db = get_db()
    s = get_settings(db)
    idx = get_index(db, (a.get("airline") or "").upper(), int(s["taxi_allowance_min"]))
    d = date.fromisoformat(a.get("date") or date.today().isoformat())
    occ = idx.occurrences(d, a.get("projection", "1") == "1")
    if a.get("adep"):
        occ = [o for o in occ if o["adep"] == a["adep"].upper()]
    return {"coverage": idx.coverage(), "items": [{**o, "dep": scheduler.fmt_utc(o["dep"]),
                                                   "arr": scheduler.fmt_utc(o["arr"])} for o in occ[:500]]}


# ================================================================== frota
@bp.get("/aircraft")
@api
def aircraft_list():
    return {"items": fleet.list_aircraft(get_db(), request.args.to_dict())}


@bp.get("/aircraft/export.csv")
def aircraft_export():
    return csv_response(fleet.export_csv(get_db(), request.args.to_dict()), "frota_aeroscale.csv")


@bp.post("/aircraft")
@api
def aircraft_create():
    aid = fleet.create_aircraft(get_db(), body())
    return fleet.get_aircraft(get_db(), aid)


@bp.get("/aircraft/<int:aid>")
@api
def aircraft_get(aid):
    a = fleet.get_aircraft(get_db(), aid)
    if not a:
        raise LookupError("Aeronave não encontrada.")
    return a


@bp.put("/aircraft/<int:aid>")
@api
def aircraft_update(aid):
    fleet.update_aircraft(get_db(), aid, body())
    return fleet.get_aircraft(get_db(), aid)


@bp.post("/aircraft/bulk")
@api
def aircraft_bulk():
    d = body()
    return fleet.bulk_update(get_db(), d.get("ids") or [], d)


@bp.post("/aircraft/<int:aid>/active")
@api
def aircraft_active(aid):
    fleet.set_active(get_db(), aid, bool(body().get("active")))
    return fleet.get_aircraft(get_db(), aid)


@bp.get("/aircraft/<int:aid>/history")
@api
def aircraft_history(aid):
    return {"items": fleet.history(get_db(), aid)}


@bp.get("/models")
@api
def models_list():
    return {"items": fleet.list_models(get_db(), request.args.get("airline"))}


@bp.post("/models")
@api
def models_create():
    return fleet.save_model(get_db(), body())


@bp.put("/models/<int:mid>")
@api
def models_update(mid):
    return fleet.save_model(get_db(), body(), mid)


@bp.delete("/models/<int:mid>")
@api
def models_delete(mid):
    fleet.delete_model(get_db(), mid)
    return {"ok": True}


@bp.get("/config-fields")
@api
def fields_list():
    return {"items": fleet.fields_for(get_db(), include_inactive=True)}


@bp.post("/config-fields")
@api
def fields_create():
    return fleet.create_field(get_db(), body())


@bp.put("/config-fields/<int:fid>")
@api
def fields_update(fid):
    fleet.update_field(get_db(), fid, body())
    return {"ok": True}


@bp.post("/fleet/preview")
@api
def fleet_preview():
    f = request.files.get("file")
    if not f:
        raise ValueError("Selecione o arquivo da lista de frota.")
    data = f.read()
    table = fleet.parse_fleet_table(data, f.filename or "")
    airline = (request.form.get("airline") or "").upper() or None
    if not airline:
        import re
        text = ((table.get("title") or "") + " " + re.sub(r"[_.\-]", " ", f.filename or "")).upper()
        for a in catalog.airlines(get_db()):
            names = {a["code"], *(a["name"].upper().split()[:1])}
            if any(n and re.search(rf"\b{re.escape(n)}\b", text) for n in names):
                airline = a["code"]
                break
    mapping = fleet.suggest_mapping(get_db(), table, airline)
    # guarda o arquivo para a etapa de confirmação
    tmp = os.path.join(current_app.config["STORAGE_DIR"], "tmp")
    os.makedirs(tmp, exist_ok=True)
    import secrets
    token = secrets.token_hex(12)
    with open(os.path.join(tmp, token + ".bin"), "wb") as fh:
        fh.write(data)
    with open(os.path.join(tmp, token + ".name"), "w", encoding="utf-8") as fh:
        fh.write(f.filename or "frota.txt")
    return {"token": token, "filename": f.filename, "airline_guess": airline, "mapping": mapping,
            "format": table["format"], "delimiter": table["delimiter"], "encoding": table["encoding"],
            "columns": table["columns"], "notes": table["notes"], "title": table["title"],
            "row_count": len(table["rows"]), "rows": table["rows"][:300],
            "list_attributes": table.get("list_attributes", [])}


@bp.post("/fleet/suggest")
@api
def fleet_suggest():
    d = body()
    token = "".join(c for c in (d.get("token") or "") if c.isalnum())
    p = os.path.join(current_app.config["STORAGE_DIR"], "tmp", token + ".bin")
    if not token or not os.path.exists(p):
        raise ValueError("Pré-visualização expirada. Envie o arquivo novamente.")
    with open(p, "rb") as fh:
        table = fleet.parse_fleet_table(fh.read())  # mapeamento não depende do nome
    return {"mapping": fleet.suggest_mapping(get_db(), table, (d.get("airline") or "").upper() or None)}


@bp.post("/fleet/apply")
@api
def fleet_apply():
    d = body()
    token = "".join(c for c in (d.get("token") or "") if c.isalnum())
    tmp = os.path.join(current_app.config["STORAGE_DIR"], "tmp")
    p = os.path.join(tmp, token + ".bin")
    if not token or not os.path.exists(p):
        raise ValueError("Pré-visualização expirada. Envie o arquivo novamente.")
    with open(p, "rb") as fh:
        data = fh.read()
    with open(os.path.join(tmp, token + ".name"), encoding="utf-8") as fh:
        fname = fh.read()
    table = fleet.parse_fleet_table(data, fname)
    st = fleet.apply_fleet_import(get_db(), table, d.get("mapping") or {}, (d.get("airline") or "").upper(), fname,
                                  data, current_app.config["STORAGE_DIR"], d.get("options") or {})
    get_db().commit()
    for ext in (".bin", ".name"):
        try:
            os.remove(os.path.join(tmp, token + ext))
        except OSError:
            pass
    return st


@bp.get("/fleet/imports")
@api
def fleet_imports():
    items = rows(get_db().execute("SELECT * FROM fleet_imports ORDER BY id DESC"))
    for i in items:
        i["stats"] = json.loads(i["stats"] or "{}")
        i["mapping"] = json.loads(i["mapping"] or "{}")
    return {"imports": items}


@bp.post("/fleet/demo")
@api
def fleet_demo():
    return {"created": fleet.seed_demo(get_db())}


@bp.delete("/fleet/demo")
@api
def fleet_demo_remove():
    return {"removed": fleet.remove_demo(get_db())}


@bp.get("/review")
@api
def review_list():
    st = request.args.get("status", "open")
    q = "SELECT f.*, a.registration, a.airline FROM review_flags f LEFT JOIN aircraft a ON f.entity='aircraft'" \
        " AND a.id=f.entity_id"
    q += " WHERE f.resolved=0" if st == "open" else " WHERE f.resolved=1" if st == "resolved" else ""
    items = rows(get_db().execute(q + " ORDER BY f.resolved, CASE f.severity WHEN 'error' THEN 0 WHEN 'warning'"
                                      " THEN 1 ELSE 2 END, f.id DESC LIMIT 1000"))
    for i in items:
        i["data"] = json.loads(i["data"] or "{}")
    return {"items": items}


@bp.post("/review/<int:fid>/resolve")
@api
def review_resolve(fid):
    return fleet.resolve_flag(get_db(), fid, body().get("action") or "ack")


# ================================================================== escalas
@bp.post("/schedules/generate")
@api
def schedule_generate():
    sid = scheduler.generate(get_db(), body())
    return scheduler.serialize_schedule(get_db(), sid)


@bp.get("/schedules")
@api
def schedules_list():
    return {"items": rows(get_db().execute(
        "SELECT s.*, a.registration, (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id) legs,"
        " (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id AND l.data_origin='REAL') real_legs,"
        " (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id AND l.data_origin='PROJETADO') proj_legs,"
        " (SELECT COUNT(*) FROM schedule_legs l WHERE l.schedule_id=s.id AND l.data_origin IN ('SUGESTAO','MANUAL'))"
        " other_legs, (SELECT COUNT(*) FROM gcal_events g WHERE g.schedule_id=s.id) gcal_events"
        " FROM schedules s LEFT JOIN aircraft a ON a.id=s.aircraft_id ORDER BY s.updated_at DESC"))}


@bp.get("/schedules/<int:sid>")
@api
def schedule_get(sid):
    s = scheduler.serialize_schedule(get_db(), sid)
    briefing.annotate_rotation(get_db(), s)
    simbrief.annotate(get_db(), s)
    s["gcal_events"] = get_db().execute("SELECT COUNT(*) c FROM gcal_events WHERE schedule_id=?",
                                        (sid,)).fetchone()["c"]
    return s


@bp.put("/schedules/<int:sid>")
@api
def schedule_update(sid):
    d = body()
    db = get_db()
    if not db.execute("SELECT 1 FROM schedules WHERE id=?", (sid,)).fetchone():
        raise LookupError("Escala não encontrada.")
    if "name" in d:
        if not d["name"].strip():
            raise ValueError("O nome não pode ficar vazio.")
        db.execute("UPDATE schedules SET name=?, updated_at=? WHERE id=?", (d["name"].strip(), now_iso(), sid))
    if "notes" in d:
        db.execute("UPDATE schedules SET notes=?, updated_at=? WHERE id=?", (d["notes"], now_iso(), sid))
    if "aircraft_id" in d:
        aid = d["aircraft_id"] or None
        s = row(db.execute("SELECT airline FROM schedules WHERE id=?", (sid,)))
        if aid:
            a = row(db.execute("SELECT a.*, m.icao_type FROM aircraft a LEFT JOIN aircraft_models m ON m.id=a.model_id"
                               " WHERE a.id=?", (aid,)))
            if not a or a["airline"] != s["airline"]:
                raise ValueError("Aeronave inválida para esta companhia.")
            db.execute("UPDATE schedule_legs SET aircraft_id=?, registration=?, type_icao=COALESCE(?, type_icao)"
                       " WHERE schedule_id=?", (aid, a["registration"], a["icao_type"], sid))
        else:
            db.execute("UPDATE schedule_legs SET aircraft_id=NULL, registration=NULL WHERE schedule_id=?", (sid,))
        db.execute("UPDATE schedules SET aircraft_id=?, updated_at=? WHERE id=?", (aid, now_iso(), sid))
    return scheduler.serialize_schedule(db, sid)


@bp.delete("/schedules/<int:sid>")
@api
def schedule_delete(sid):
    db = get_db()
    db.execute("DELETE FROM schedules WHERE id=?", (sid,))
    db.execute("DELETE FROM gcal_events WHERE schedule_id=?", (sid,))
    return {"ok": True}


@bp.post("/schedules/<int:sid>/regenerate")
@api
def schedule_regenerate(sid):
    d = body()
    r = scheduler.regenerate(get_db(), sid, d.get("from_leg_id"), d.get("day"))
    return {**r, "schedule": scheduler.serialize_schedule(get_db(), sid)}


@bp.post("/schedules/<int:sid>/reserve/redraw")
@api
def schedule_reserve_redraw(sid):
    """Novo sorteio da reserva (datas, local e acionamento); os voos fora da reserva são replanejados com a mesma semente."""
    d = body()
    db = get_db()
    sched = row(db.execute("SELECT params FROM schedules WHERE id=?", (sid,)))
    if not sched:
        raise LookupError("Escala não encontrada.")
    if d.get("blocks") is not None:  # permite ligar a reserva numa escala antiga ou mudar a quantidade
        p = json.loads(sched["params"] or "{}")
        n = int(d["blocks"])
        if not 0 <= n <= 4:
            raise ValueError("Quantidade de reservas entre 0 e 4.")
        p["reserve_blocks"] = n
        db.execute("UPDATE schedules SET params=? WHERE id=?", (json.dumps(p, ensure_ascii=False), sid))
    r = scheduler.regenerate(db, sid, new_seed=False, redraw_reserve=True)
    return {**r, "schedule": scheduler.serialize_schedule(db, sid)}


@bp.post("/schedules/<int:sid>/sort")
@api
def schedule_sort(sid):
    scheduler.sort_by_time(get_db(), sid)
    return scheduler.serialize_schedule(get_db(), sid)


@bp.get("/schedules/<int:sid>/alternatives")
@api
def schedule_alternatives(sid):
    return scheduler.alternatives(get_db(), sid=sid, mode="start")


@bp.post("/schedules/<int:sid>/legs")
@api
def schedule_add_leg(sid):
    d = body()
    if d.get("ref"):
        scheduler.apply_occurrence(get_db(), sid, d["ref"], d.get("replace_leg_id"), d.get("after_leg_id"))
    else:
        scheduler.add_manual_leg(get_db(), sid, d)
    return scheduler.serialize_schedule(get_db(), sid)


@bp.get("/schedules/<int:sid>/export.csv")
def schedule_csv(sid):
    s = row(get_db().execute("SELECT name FROM schedules WHERE id=?", (sid,)))
    if not s:
        return jsonify({"error": "Escala não encontrada."}), 404
    fn = "".join(c if c.isalnum() else "_" for c in s["name"])[:60] + ".csv"
    return csv_response(scheduler.export_csv(get_db(), sid), fn)


@bp.get("/schedules/<int:sid>/export.txt")
def schedule_txt(sid):
    s = row(get_db().execute("SELECT name FROM schedules WHERE id=?", (sid,)))
    if not s:
        return jsonify({"error": "Escala não encontrada."}), 404
    fn = "".join(c if c.isalnum() else "_" for c in s["name"])[:60] + ".txt"
    txt = scheduler.export_txt(get_db(), sid).replace("\n", "\r\n")  # quebra de linha do Bloco de Notas
    return Response(txt.encode("utf-8"), mimetype="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{fn}"'})


@bp.get("/schedules/<int:sid>/text")
@api
def schedule_text(sid):
    return {"text": scheduler.export_txt(get_db(), sid)}


@bp.get("/schedules/<int:sid>/export.ics")
def schedule_ics(sid):
    s = row(get_db().execute("SELECT name FROM schedules WHERE id=?", (sid,)))
    if not s:
        return jsonify({"error": "Escala não encontrada."}), 404
    fn = "".join(c if c.isalnum() else "_" for c in s["name"])[:60] + ".ics"
    return csv_response(scheduler.export_ics(get_db(), sid), fn, "text/calendar; charset=utf-8")


@bp.put("/legs/<int:lid>")
@api
def leg_update(lid):
    scheduler.update_leg(get_db(), lid, body())
    sid = get_db().execute("SELECT schedule_id FROM schedule_legs WHERE id=?", (lid,)).fetchone()["schedule_id"]
    return scheduler.serialize_schedule(get_db(), sid)


@bp.delete("/legs/<int:lid>")
@api
def leg_delete(lid):
    r = row(get_db().execute("SELECT schedule_id FROM schedule_legs WHERE id=?", (lid,)))
    if not r:
        raise LookupError("Perna não encontrada.")
    scheduler.delete_leg(get_db(), lid)
    return scheduler.serialize_schedule(get_db(), r["schedule_id"])


@bp.post("/legs/<int:lid>/move")
@api
def leg_move(lid):
    scheduler.move_leg(get_db(), lid, int(body().get("direction", 1)))
    sid = get_db().execute("SELECT schedule_id FROM schedule_legs WHERE id=?", (lid,)).fetchone()["schedule_id"]
    return scheduler.serialize_schedule(get_db(), sid)


@bp.get("/legs/<int:lid>/alternatives")
@api
def leg_alternatives(lid):
    return scheduler.alternatives(get_db(), leg_id=lid, mode=request.args.get("mode", "replace"))


# ================================================================== Google Calendar
@bp.get("/google/status")
@api
def google_status():
    return gcal().status()


@bp.post("/google/credentials")
@api
def google_credentials():
    f = request.files.get("file")
    if not f:
        raise ValueError("Selecione o arquivo JSON da credencial OAuth.")
    return {"client": {k: v for k, v in gcal().save_client(f.read()).items() if k != "client_secret"}}


def _redirect_uri() -> str:
    custom = get_settings(get_db()).get("google_redirect_uri")
    return custom or request.host_url.rstrip("/") + "/api/google/callback"


@bp.get("/google/auth")
def google_auth():
    g = gcal()
    try:
        verifier, challenge = g.new_pkce()
        import secrets
        state = secrets.token_urlsafe(24)
        session["g_state"], session["g_verifier"], session["g_redirect"] = state, verifier, _redirect_uri()
        return redirect(g.authorization_url(session["g_redirect"], state, challenge))
    except GoogleError as e:
        return redirect("/#/configuracoes?google_error=" + _q(str(e)))


def _q(s):
    import urllib.parse
    return urllib.parse.quote(s)


@bp.get("/google/callback")
def google_callback():
    if request.args.get("error"):
        return redirect("/#/configuracoes?google_error=" + _q("Autorização negada: " + request.args["error"]))
    if not request.args.get("state") or request.args.get("state") != session.get("g_state"):
        return redirect("/#/configuracoes?google_error=" + _q("Estado OAuth inválido; tente conectar de novo."))
    try:
        gcal().exchange_code(request.args.get("code", ""), session.get("g_redirect"), session.get("g_verifier"))
    except GoogleError as e:
        return redirect("/#/configuracoes?google_error=" + _q(str(e)))
    finally:
        for k in ("g_state", "g_verifier"):
            session.pop(k, None)
    return redirect("/#/configuracoes?google_ok=1")


@bp.post("/google/disconnect")
@api
def google_disconnect():
    gcal().disconnect()
    return {"ok": True}


@bp.get("/google/calendars")
@api
def google_calendars():
    return {"items": gcal().list_calendars(), "selected": get_settings(get_db()).get("google_calendar_id")}


@bp.post("/google/calendars")
@api
def google_calendar_create():
    c = gcal().create_calendar((body().get("summary") or "AeroScale – Escalas").strip())
    set_settings(get_db(), {"google_calendar_id": c["id"]})
    return c


@bp.post("/schedules/<int:sid>/google-sync")
@api
def google_sync(sid):
    d = body()
    cal = d.get("calendar_id") or get_settings(get_db()).get("google_calendar_id")
    if not cal:
        raise ValueError("Escolha a agenda de destino em Configurações → Google Calendar.")
    rep = gcal().sync_schedule(get_db(), sid, cal, bool(d.get("remove_deleted", True)))
    set_settings(get_db(), {"google_calendar_id": cal})
    return rep


@bp.post("/schedules/<int:sid>/google-remove")
@api
def google_remove(sid):
    cal = body().get("calendar_id") or get_settings(get_db()).get("google_calendar_id")
    if not cal:
        raise ValueError("Nenhuma agenda selecionada.")
    return gcal().remove_schedule(get_db(), sid, cal)


# ================================================================== backup
@bp.get("/backup/export")
def backup_export():
    data, name = backup.export_backup(current_app.config, request.args.get("credentials", "1") == "1",
                                      request.args.get("token") == "1")
    return Response(data, mimetype="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@bp.post("/backup/import")
@api
def backup_import():
    f = request.files.get("file")
    if not f:
        raise ValueError("Selecione o arquivo .zip do backup.")
    get_db().commit()
    return backup.import_backup(current_app.config, f.read())


@bp.get("/backup/points")
@api
def backup_points():
    return {"items": backup.list_restore_points(current_app.config),
            "data_dir": current_app.config["DATA_DIR"]}


@bp.post("/backup/points")
@api
def backup_point_create():
    p = backup.save_restore_point(current_app.config, "manual")
    return {"name": os.path.basename(p)}


@bp.get("/backup/points/<name>")
def backup_point_download(name):
    p = backup.restore_point_path(current_app.config, name)
    if not p:
        return jsonify({"error": "Ponto de restauração não encontrado."}), 404
    with open(p, "rb") as fh:
        return Response(fh.read(), mimetype="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ================================================================== meteorologia
def _ids():
    return [x for x in (request.args.get("ids") or "").replace(";", ",").replace(" ", ",").split(",") if x]


@bp.get("/weather/metar")
@api
def weather_metar():
    ids = _ids()
    if not ids:
        raise ValueError("Informe ao menos um código ICAO (ex.: SBGR).")
    ttl = int(get_settings(get_db()).get("metar_ttl_min") or 10)
    return {"items": weather.get_metars(get_db(), ids, ttl, request.args.get("force") == "1"),
            "ttl_min": ttl, "now_utc": weather.iso(weather.now_utc())}


@bp.get("/weather/taf")
@api
def weather_taf():
    ids = _ids()
    if not ids:
        raise ValueError("Informe ao menos um código ICAO.")
    return {"items": weather.get_tafs(get_db(), ids, 30, request.args.get("force") == "1")}


# ================================================================== briefing
@bp.get("/legs/<int:lid>/briefing")
@api
def leg_briefing(lid):
    return briefing.leg_briefing(get_db(), lid, request.args.get("force") == "1")


@bp.get("/legs/<int:lid>/briefing.html")
def leg_briefing_html(lid):
    try:
        b = briefing.leg_briefing(get_db(), lid)
        get_db().commit()
    except LookupError as e:
        return jsonify({"error": str(e)}), 404
    name = f"briefing_{b['leg'].get('flight_number') or 'POS'}_{b['leg']['adep']}-{b['leg']['ades']}_{b['leg']['local_date']}.html"
    return Response(briefing_html.render_leg(b), mimetype="text/html",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@bp.get("/legs/<int:lid>/simbrief")
@api
def leg_simbrief(lid):
    """Link do SimBrief com ajustes opcionais (?altn=SBKP&fl=350&route=...)."""
    db = get_db()
    leg = row(db.execute("SELECT * FROM schedule_legs WHERE id=?", (lid,)))
    if not leg:
        raise LookupError("Perna não encontrada.")
    ac = briefing._aircraft_info(db, leg.get("aircraft_id"))
    ov = {}
    altn = (request.args.get("altn") or "").strip().upper()
    if altn:
        if not re.fullmatch(r"[A-Z]{4}", altn):
            raise ValueError("Alternado deve ser um ICAO de 4 letras.")
        ov["altn"] = altn
    fl = (request.args.get("fl") or "").strip().upper()
    if fl:
        if not re.fullmatch(r"(FL|F)?\d{2,3}", fl):
            raise ValueError("Nível inválido (ex.: 350 ou FL350).")
        ov["fl"] = re.sub(r"^FL?", "", fl)
    if request.args.get("route") is not None:
        ov["route"] = re.sub(r"\s+", " ", request.args.get("route", "").upper()).strip()
    return simbrief.build(db, leg, ac, overrides=ov)


@bp.get("/schedules/<int:sid>/briefing")
@api
def schedule_briefing(sid):
    return briefing.schedule_briefing(get_db(), sid, request.args.get("date"), request.args.get("force") == "1")


@bp.get("/schedules/<int:sid>/briefing.html")
def schedule_briefing_html(sid):
    try:
        b = briefing.schedule_briefing(get_db(), sid, request.args.get("date"))
        get_db().commit()
    except (LookupError, ValueError) as e:
        return jsonify({"error": str(e)}), 404
    return Response(briefing_html.render_day(b), mimetype="text/html",
                    headers={"Content-Disposition": f'attachment; filename="briefing_dia_{b["day"]}.html"'})


# ================================================================== previsão de continuidade
_QUALITY_CACHE: dict = {}


@bp.get("/predict/next")
@api
def predict_next():
    a = request.args
    db = get_db()
    airline = (a.get("airline") or "").upper()
    ident = (a.get("ident") or "").upper().replace(" ", "")
    if not airline or not ident:
        raise ValueError("Informe companhia e voo (ex.: GLO1964).")
    import re as _re
    num = _re.sub(r"^(?:[A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])(?=\d)", "", ident)  # GLO1964, G31964, LA3633, 1964
    if num.isdigit():
        ident = airline + num
    try:
        d = date.fromisoformat(a.get("date") or date.today().isoformat())
    except ValueError:
        raise ValueError("Data inválida.")
    taxi = int(get_settings(db)["taxi_allowance_min"] or 0)
    idx = get_index(db, airline, taxi)
    occs = [o for o in idx.occurrences(d, True) if o["ident"] == ident]
    if a.get("adep"):
        occs = [o for o in occs if o["adep"] == a["adep"].upper()]
    if not occs:
        raise LookupError(f"{ident} não opera em {d:%d/%m/%Y} nos RPL ativos (nem por projeção).")
    apmap = catalog.airport_map(db)
    tz_of = lambda icao: catalog.airport_tz(apmap, icao)  # noqa: E731
    model = predict.RotationModel(idx, airline, (a.get("type") or "").upper() or None, tz_of, True,
                                  "exact" if a.get("type_mode") == "exact" else "family",
                                  weights=predict.weights_for(get_settings(db), airline))
    out = []
    for o in occs:
        cands = model.candidates(o)
        out.append({"current": briefing._with_local({**{k: o[k] for k in ("ref", "ident", "adep", "ades", "type_icao",
                                                                             "origin")},
                                                     "dep_utc": scheduler.fmt_utc(o["dep"]),
                                                     "arr_utc": scheduler.fmt_utc(o["arr"])}, apmap),
                    "candidates": [briefing._with_local(predict.describe(c, len(cands)), apmap) for c in cands[:10]],
                    "n": len(cands),
                    "chain": [briefing._with_local(c, apmap) for c in model.chain(o, steps=int(a.get("steps", 5)))]})
    return {"items": out, "coverage": idx.coverage(),
            "seasonality": "Dados de 1 semana de RPL: padrão por dia da semana disponível; sazonalidade exige RPL de "
                           "várias semanas." if (idx.cov_from and idx.cov_to and
                                                 (date.fromisoformat(idx.cov_to) - date.fromisoformat(idx.cov_from)).days < 14)
            else "RPL com mais de 2 semanas: frequência semanal considerada."}


@bp.get("/predict/quality")
@api
def predict_quality():
    db = get_db()
    s = get_settings(db)
    wba = predict.weights_by_airline(s)
    ver = tuple(db.execute("SELECT COUNT(*), COALESCE(MAX(id),0), COALESCE(SUM(active),0) FROM rpl_imports").fetchone()) \
        + (json.dumps(wba, sort_keys=True),)
    if ver not in _QUALITY_CACHE:
        apmap = catalog.airport_map(db)
        _QUALITY_CACHE.clear()
        _QUALITY_CACHE[ver] = predict.backtest(db, get_index, lambda icao: catalog.airport_tz(apmap, icao), wba or None)
    r = _QUALITY_CACHE[ver]
    return {**r, "weights": predict.WEIGHTS, "weights_by_airline": wba, "weights_info": s.get("model_weights_info"),
            "turn_typical": predict.TURN_TYPICAL}


# ================================================================== ADS-B (adsb.lol)
def _adsb_prefixes(raw=None) -> list[str]:
    txt = raw if raw is not None else get_settings(get_db()).get("adsb_prefixes") or "GLO,TAM,AZU"
    if isinstance(txt, list):
        txt = ",".join(txt)
    out = [p.strip().upper() for p in re.split(r"[,; ]+", txt) if p.strip()]
    if not out or not all(re.fullmatch(r"[A-Z]{3}", p) for p in out):
        raise ValueError("Indicativos devem ser códigos ICAO de 3 letras (ex.: GLO, TAM, AZU).")
    return out


@bp.get("/adsb/summary")
@api
def adsb_summary():
    return adsb.summary(get_db())


@bp.post("/adsb/jobs")
@api
def adsb_start():
    d = body()
    try:
        d1 = date.fromisoformat(d.get("from") or d.get("date"))
        d2 = date.fromisoformat(d.get("to") or d.get("from") or d.get("date"))
    except (TypeError, ValueError):
        raise ValueError("Informe as datas (de/até).")
    if d2 < d1:
        d1, d2 = d2, d1
    if (d2 - d1).days > 30:
        raise ValueError("Máximo de 31 dias por vez (cada dia baixa cerca de 3 GB).")
    if d2 >= datetime.now(timezone.utc).date():
        raise ValueError("O adsb.lol publica cada dia no GitHub cerca de 1 dia depois; escolha até ontem (UTC).")
    prefixes = _adsb_prefixes(d.get("prefixes"))
    set_settings(get_db(), {"adsb_prefixes": ",".join(prefixes)})
    get_db().commit()
    days = [d1 + timedelta(days=i) for i in range((d2 - d1).days + 1)]
    return adsb.start_job(current_app.config["DATABASE"], days, prefixes, not d.get("all_hex"),
                          not d.get("reprocess"))


@bp.get("/adsb/jobs/current")
@api
def adsb_job():
    return adsb.job_status()


@bp.post("/adsb/jobs/cancel")
@api
def adsb_cancel():
    adsb.cancel_job()
    return adsb.job_status()


@bp.get("/adsb/aircraft")
@api
def adsb_aircraft():
    a = request.args
    q = ("SELECT x.*, f.id AS fleet_id, f.airline AS fleet_airline, m.icao_type AS fleet_type,"
         " (SELECT COUNT(*) FROM adsb_legs l WHERE l.hex=x.hex) AS legs,"
         " (SELECT COUNT(*) FROM adsb_legs l WHERE l.hex=x.hex AND l.source='rpl') AS legs_rpl FROM adsb_aircraft x"
         " LEFT JOIN aircraft f ON f.registration=x.registration LEFT JOIN aircraft_models m ON m.id=f.model_id WHERE 1=1")
    args = []
    if a.get("airline"):
        q += " AND x.airline=?"
        args.append(a["airline"].upper())
    if a.get("q"):
        q += " AND (x.registration LIKE ? OR x.hex LIKE ? OR x.icao_type LIKE ? OR x.last_callsign LIKE ?)"
        args += [f"%{a['q'].upper()}%", f"%{a['q'].lower()}%", f"%{a['q'].upper()}%", f"%{a['q'].upper()}%"]
    if a.get("fleet") == "fora":
        q += " AND f.id IS NULL"
    items = rows(get_db().execute(q + " ORDER BY x.airline, x.registration IS NULL, x.registration", args))
    fams: dict = {}
    for it in items:
        if it["airline"] not in fams:
            fams[it["airline"]] = adsb.airline_families(get_db(), it["airline"])
        it["suspect"] = adsb.suspect_reason(it, fams[it["airline"]])
    return {"items": items}


@bp.get("/adsb/aircraft/<hx>/legs")
@api
def adsb_aircraft_legs(hx):
    db = get_db()
    ac = row(db.execute("SELECT * FROM adsb_aircraft WHERE hex=?", (hx.lower(),)))
    if not ac:
        raise LookupError("Aeronave não encontrada nos dados ADS-B.")
    apmap = catalog.airport_map(db)
    legs = rows(db.execute("SELECT * FROM adsb_legs WHERE hex=? ORDER BY dep_utc", (hx.lower(),)))
    tz_of = lambda icao: catalog.airport_tz(apmap, icao)  # noqa: E731
    for i, l in enumerate(legs):
        for k in ("dep", "arr"):
            ap = l["adep"] if k == "dep" else l["ades"]
            t = l[f"{k}_utc"]
            if t:
                l[f"{k}_local"] = to_local(datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc),
                                           tz_of(ap) if ap else None).strftime("%Y-%m-%dT%H:%M")
        if i and l["adep"] and legs[i - 1]["ades"]:
            a, b = legs[i - 1], l
            ga = datetime.strptime(b["dep_utc"], "%Y-%m-%dT%H:%M:%SZ") - datetime.strptime(a["arr_utc"], "%Y-%m-%dT%H:%M:%SZ")
            kind = "lacuna_dados" if b["adep"] != a["ades"] else predict.gap_kind(
                datetime.strptime(a["arr_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc),
                datetime.strptime(b["dep_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc), b["adep"], tz_of, 0)
            l["gap_before"] = {"minutes": int(ga.total_seconds() // 60), "kind": kind,
                               "label": predict.GAP_LABEL.get(kind, kind)}
    return {"aircraft": ac, "legs": legs}


@bp.post("/adsb/to-fleet")
@api
def adsb_to_fleet():
    d = body()
    return adsb.to_fleet(get_db(), (d.get("airline") or "").upper() or None, d.get("hexes") or None,
                         bool(d.get("fill_models", True)))


@bp.get("/adsb/stats")
@api
def adsb_stats():
    db = get_db()
    trans = adsb.transitions(db)
    wba = predict.weights_by_airline(get_settings(db))
    return {"real": adsb.real_stats(db), "model": adsb.evaluate(db, trans, wba), "transitions": len(trans),
            "weights_by_airline": wba, "weights_info": get_settings(db).get("model_weights_info"),
            "default_weights": predict.WEIGHTS}


@bp.post("/adsb/calibrate")
@api
def adsb_calibrate():
    return adsb.calibrate(get_db())


@bp.post("/adsb/weights")
@api
def adsb_apply_weights():
    d = body()
    w = d.get("weights") or {}
    clean = {}
    for al, ws in w.items():
        if not re.fullmatch(r"[A-Z]{3}", str(al)) or not isinstance(ws, dict):
            raise ValueError("Pesos inválidos.")
        clean[al] = {k: round(float(v), 3) for k, v in ws.items() if k in predict.WEIGHTS and abs(float(v)) <= 20}
    info = {"at": now_iso(), "transitions": d.get("transitions"), "airlines": sorted(clean)} if clean else None
    set_settings(get_db(), {"model_weights": clean, "model_weights_info": info})
    _QUALITY_CACHE.clear()
    return {"weights": clean, "info": info}


@bp.post("/adsb/rematch")
@api
def adsb_rematch():
    return adsb.match_runs(get_db())


@bp.delete("/adsb/days/<day>")
@api
def adsb_delete_day(day):
    return adsb.delete_day(get_db(), day)


@bp.get("/adsb/aircraft.csv")
def adsb_aircraft_csv():
    al = (request.args.get("airline") or "").upper() or None
    return Response(adsb.export_csv(get_db(), al), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="matriculas_adsb{("_" + al) if al else ""}.csv"'})

