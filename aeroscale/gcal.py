"""Integração com Google Calendar (API v3) via OAuth 2.0.

Usa os endpoints oficiais do Google diretamente (urllib da biblioteca padrão),
com o fluxo "authorization code" + PKCE (S256) e refresh token. Assim não há
dependências extras para instalar no Windows.

Arquivos (pasta data/):
  google_client_secret.json  – credencial OAuth baixada do Google Cloud Console
  google_token.json          – tokens do usuário (gerado após autorizar)

Os endereços podem ser trocados por variáveis de ambiente (usado nos testes):
  AEROSCALE_GOOGLE_AUTH_URL, AEROSCALE_GOOGLE_TOKEN_URL, AEROSCALE_GOOGLE_API
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

from . import catalog
from .db import now_iso, rows
from .scheduler import leg_text, reserve_text, serialize_schedule

SCOPE = "https://www.googleapis.com/auth/calendar"
COLOR_BY_ORIGIN = {"REAL": "6", "PROJETADO": "7", "SUGESTAO": "3", "MANUAL": "8"}


def _auth_url():
    return os.environ.get("AEROSCALE_GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth")


def _token_url():
    return os.environ.get("AEROSCALE_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")


def _api():
    return os.environ.get("AEROSCALE_GOOGLE_API", "https://www.googleapis.com/calendar/v3")


class GoogleError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class GoogleCalendar:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.client_path = os.path.join(data_dir, "google_client_secret.json")
        self.token_path = os.path.join(data_dir, "google_token.json")

    # ------------------------------------------------------------ credenciais
    def load_client(self) -> dict | None:
        if not os.path.exists(self.client_path):
            return None
        with open(self.client_path, encoding="utf-8") as fh:
            data = json.load(fh)
        kind = "web" if "web" in data else "installed" if "installed" in data else None
        if not kind:
            return None
        c = data[kind]
        return {"type": kind, "client_id": c.get("client_id"), "client_secret": c.get("client_secret"),
                "redirect_uris": c.get("redirect_uris", []), "project_id": c.get("project_id")}

    def save_client(self, raw: bytes) -> dict:
        try:
            data = json.loads(raw.decode("utf-8-sig"))
        except Exception:
            raise GoogleError("Arquivo inválido: envie o JSON baixado do Google Cloud Console.")
        kind = "web" if "web" in data else "installed" if "installed" in data else None
        if not kind or not data[kind].get("client_id") or not data[kind].get("client_secret"):
            raise GoogleError("JSON sem 'client_id'/'client_secret'. Baixe a credencial do tipo "
                              "'ID do cliente OAuth' (Aplicativo da Web ou Computador).")
        os.makedirs(self.data_dir, exist_ok=True)
        with open(self.client_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        return self.load_client()

    def load_token(self) -> dict | None:
        if not os.path.exists(self.token_path):
            return None
        with open(self.token_path, encoding="utf-8") as fh:
            return json.load(fh)

    def save_token(self, tok: dict):
        os.makedirs(self.data_dir, exist_ok=True)
        with open(self.token_path, "w", encoding="utf-8") as fh:
            json.dump(tok, fh)

    def status(self) -> dict:
        c = self.load_client()
        t = self.load_token()
        return {"configured": bool(c), "client_type": c["type"] if c else None,
                "project_id": c.get("project_id") if c else None,
                "redirect_uris": c["redirect_uris"] if c else [],
                "connected": bool(t and t.get("refresh_token")), "connected_at": t.get("connected_at") if t else None}

    # ------------------------------------------------------------ OAuth
    @staticmethod
    def new_pkce() -> tuple[str, str]:
        verifier = secrets.token_urlsafe(64)[:96]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        return verifier, challenge

    def authorization_url(self, redirect_uri: str, state: str, challenge: str) -> str:
        c = self.load_client()
        if not c:
            raise GoogleError("Envie primeiro o arquivo de credenciais OAuth (Configurações → Google Calendar).")
        q = {"client_id": c["client_id"], "redirect_uri": redirect_uri, "response_type": "code", "scope": SCOPE,
             "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "state": state,
             "code_challenge": challenge, "code_challenge_method": "S256"}
        return _auth_url() + "?" + urllib.parse.urlencode(q)

    def exchange_code(self, code: str, redirect_uri: str, verifier: str):
        c = self.load_client()
        tok = self._post_form(_token_url(), {
            "code": code, "client_id": c["client_id"], "client_secret": c["client_secret"],
            "redirect_uri": redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier})
        if "refresh_token" not in tok:
            raise GoogleError("O Google não devolveu refresh token. Remova o acesso do AeroScale em "
                              "myaccount.google.com/permissions e conecte de novo.")
        tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600))
        tok["connected_at"] = now_iso()
        self.save_token(tok)

    def disconnect(self):
        t = self.load_token()
        if t:
            try:
                self._post_form("https://oauth2.googleapis.com/revoke"
                                if "AEROSCALE_GOOGLE_TOKEN_URL" not in os.environ
                                else _token_url().replace("/token", "/revoke"),
                                {"token": t.get("refresh_token") or t.get("access_token")})
            except GoogleError:
                pass  # mesmo que a revogação falhe, removemos o token local
            os.remove(self.token_path)

    def _access_token(self, force_refresh=False) -> str:
        t = self.load_token()
        if not t or not t.get("refresh_token"):
            raise GoogleError("Google Calendar não conectado. Conecte em Configurações.", 401)
        if force_refresh or time.time() > t.get("expires_at", 0) - 60:
            c = self.load_client()
            if not c:
                raise GoogleError("Credencial OAuth ausente.")
            new = self._post_form(_token_url(), {
                "client_id": c["client_id"], "client_secret": c["client_secret"],
                "refresh_token": t["refresh_token"], "grant_type": "refresh_token"})
            t["access_token"] = new["access_token"]
            t["expires_at"] = time.time() + int(new.get("expires_in", 3600))
            if new.get("refresh_token"):
                t["refresh_token"] = new["refresh_token"]
            self.save_token(t)
        return t["access_token"]

    # ------------------------------------------------------------ HTTP
    @staticmethod
    def _read_error(e: urllib.error.HTTPError) -> str:
        try:
            body = json.loads(e.read().decode("utf-8"))
            err = body.get("error")
            if isinstance(err, dict):
                return err.get("message") or str(err)
            return body.get("error_description") or str(err)
        except Exception:
            return f"HTTP {e.code}"

    def _post_form(self, url, data: dict) -> dict:
        req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else {}
        except urllib.error.HTTPError as e:
            msg = self._read_error(e)
            if "invalid_grant" in msg or e.code == 400 and "grant" in msg:
                raise GoogleError("Autorização do Google expirou ou foi revogada. Conecte novamente.", 401)
            raise GoogleError(f"Erro do Google OAuth: {msg}", e.code)
        except urllib.error.URLError as e:
            raise GoogleError(f"Sem conexão com o Google: {e.reason}")

    def request(self, method: str, path: str, params: dict | None = None, body: dict | None = None,
                _retry=True) -> dict:
        url = _api() + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self._access_token()}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else {}
        except urllib.error.HTTPError as e:
            if e.code == 401 and _retry:
                self._access_token(force_refresh=True)
                return self.request(method, path, params, body, _retry=False)
            raise GoogleError(self._read_error(e), e.code)
        except urllib.error.URLError as e:
            raise GoogleError(f"Sem conexão com o Google: {e.reason}")

    # ------------------------------------------------------------ agendas
    def list_calendars(self) -> list[dict]:
        out, token = [], None
        while True:
            params = {"minAccessRole": "writer", "maxResults": 250}
            if token:
                params["pageToken"] = token
            r = self.request("GET", "/users/me/calendarList", params)
            out += [{"id": c["id"], "summary": c.get("summaryOverride") or c.get("summary"),
                     "primary": bool(c.get("primary")), "timeZone": c.get("timeZone")} for c in r.get("items", [])]
            token = r.get("nextPageToken")
            if not token:
                return out

    def create_calendar(self, summary="AeroScale – Escalas", tz="America/Sao_Paulo") -> dict:
        r = self.request("POST", "/calendars", body={"summary": summary, "timeZone": tz,
                                                     "description": "Escalas de simulação geradas pelo AeroScale"})
        return {"id": r["id"], "summary": r.get("summary")}

    def _events_by_prop(self, cal: str, prop: str) -> list[dict]:
        out, token = [], None
        while True:
            params = {"privateExtendedProperty": prop, "maxResults": 2500, "showDeleted": "false"}
            if token:
                params["pageToken"] = token
            r = self.request("GET", f"/calendars/{urllib.parse.quote(cal, safe='')}/events", params)
            out += r.get("items", [])
            token = r.get("nextPageToken")
            if not token:
                return out

    # ------------------------------------------------------------ sincronização
    @staticmethod
    def event_body(leg: dict, sched: dict, apmap: dict) -> dict:
        title, desc = leg_text(leg, sched["name"])
        tz_d = catalog.airport_tz(apmap, leg["adep"]) or "UTC"
        tz_a = catalog.airport_tz(apmap, leg["ades"]) or "UTC"
        return {
            "summary": ("✈ " + title) + (" [PROJETADO]" if leg["data_origin"] == "PROJETADO" else
                                          " [SUGESTÃO]" if leg["data_origin"] == "SUGESTAO" else ""),
            "description": desc,
            "location": f"{leg.get('adep_name') or leg['adep']} ({leg['adep']})",
            "start": {"dateTime": leg["dep_utc"], "timeZone": tz_d},
            "end": {"dateTime": leg["arr_utc"], "timeZone": tz_a},
            "colorId": COLOR_BY_ORIGIN.get(leg["data_origin"], "8"),
            "extendedProperties": {"private": {"aeroscaleLegUid": leg["uid"],
                                               "aeroscaleScheduleId": str(sched["id"])}},
        }

    @staticmethod
    def reserve_body(r: dict, sched: dict) -> dict:
        title, desc = reserve_text(r, sched)
        end_excl = (date.fromisoformat(r["end_date"]) + timedelta(days=1)).isoformat()
        return {
            "summary": "🕒 " + title,
            "description": desc,
            "location": r["location"],
            "start": {"date": r["start_date"]},
            "end": {"date": end_excl},
            "transparency": "transparent",
            "colorId": "5" if r["status"] == "acionado" else "8",
            "extendedProperties": {"private": {"aeroscaleLegUid": "reserva-" + r["uid"],
                                               "aeroscaleScheduleId": str(sched["id"])}},
        }

    def sync_schedule(self, db, sid: int, calendar_id: str, remove_deleted=True) -> dict:
        if not calendar_id:
            raise GoogleError("Escolha a agenda do Google de destino.")
        sched = serialize_schedule(db, sid)
        apmap = catalog.airport_map(db)
        cal_q = urllib.parse.quote(calendar_id, safe="")
        maps = {r["leg_uid"]: r for r in rows(db.execute(
            "SELECT * FROM gcal_events WHERE calendar_id=? AND schedule_id=?", (calendar_id, sid)))}
        # eventos já existentes desta escala no Google (recupera vínculos perdidos e acha duplicatas)
        remote = self._events_by_prop(calendar_id, f"aeroscaleScheduleId={sid}")
        by_uid: dict[str, list[dict]] = {}
        for ev in remote:
            uid = ((ev.get("extendedProperties") or {}).get("private") or {}).get("aeroscaleLegUid")
            if uid:
                by_uid.setdefault(uid, []).append(ev)
        rep = {"created": 0, "updated": 0, "unchanged": 0, "deleted": 0, "duplicates_removed": 0, "errors": []}
        current = set()
        items = [(leg["uid"], self.event_body(leg, sched, apmap), leg) for leg in sched["legs"]]
        items += [("reserva-" + r["uid"], self.reserve_body(r, sched),
                   {"uid": "reserva-" + r["uid"], "flight_number": "RESERVA", "adep": r["location"], "ades": r["location"]})
                  for r in sched.get("reserves") or []]
        for _uid, body, leg in items:
            current.add(leg["uid"])
            h = hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            found = by_uid.get(leg["uid"], [])
            for extra in found[1:]:
                try:
                    self.request("DELETE", f"/calendars/{cal_q}/events/{extra['id']}")
                    rep["duplicates_removed"] += 1
                except GoogleError as e:
                    if e.status not in (404, 410):
                        rep["errors"].append(f"{leg['flight_number']}: {e}")
            m = maps.get(leg["uid"])
            event_id = found[0]["id"] if found else (m["event_id"] if m else None)
            try:
                if event_id and m and m["content_hash"] == h and found:
                    rep["unchanged"] += 1
                    continue
                if event_id:
                    try:
                        ev = self.request("PUT", f"/calendars/{cal_q}/events/{event_id}", body=body)
                        rep["updated"] += 1
                    except GoogleError as e:
                        if e.status not in (404, 410):
                            raise
                        ev = self.request("POST", f"/calendars/{cal_q}/events", body=body)
                        rep["created"] += 1
                else:
                    ev = self.request("POST", f"/calendars/{cal_q}/events", body=body)
                    rep["created"] += 1
                db.execute("INSERT OR REPLACE INTO gcal_events(leg_uid, calendar_id, event_id, schedule_id,"
                           " content_hash, synced_at) VALUES (?,?,?,?,?,?)",
                           (leg["uid"], calendar_id, ev["id"], sid, h, now_iso()))
            except GoogleError as e:
                rep["errors"].append(f"{leg['flight_number'] or 'POS'} {leg['adep']}-{leg['ades']}: {e}")
                if e.status == 401:
                    break
        if remove_deleted:
            stale = {uid for uid in set(maps) | set(by_uid) if uid not in current}
            for uid in stale:
                ids = {e["id"] for e in by_uid.get(uid, [])}
                if uid in maps:
                    ids.add(maps[uid]["event_id"])
                for eid in ids:
                    try:
                        self.request("DELETE", f"/calendars/{cal_q}/events/{eid}")
                        rep["deleted"] += 1
                    except GoogleError as e:
                        if e.status not in (404, 410):
                            rep["errors"].append(f"remoção {eid}: {e}")
                db.execute("DELETE FROM gcal_events WHERE leg_uid=? AND calendar_id=?", (uid, calendar_id))
        return rep

    def remove_schedule(self, db, sid: int, calendar_id: str) -> dict:
        cal_q = urllib.parse.quote(calendar_id, safe="")
        n = 0
        for ev in self._events_by_prop(calendar_id, f"aeroscaleScheduleId={sid}"):
            try:
                self.request("DELETE", f"/calendars/{cal_q}/events/{ev['id']}")
                n += 1
            except GoogleError as e:
                if e.status not in (404, 410):
                    raise
        db.execute("DELETE FROM gcal_events WHERE schedule_id=? AND calendar_id=?", (sid, calendar_id))
        return {"deleted": n}
