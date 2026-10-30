"""Testes automatizados do AeroScale.  Rodar:  python -m unittest discover -s tests -v"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from aeroscale import create_app  # noqa: E402
from aeroscale.rpl_parser import parse_rpl  # noqa: E402

SAMPLES = os.path.join(ROOT, "samples")


def sample(name):
    with open(os.path.join(ROOT, "rpl", name), "rb") as fh:
        return fh.read()


def utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class ParserTests(unittest.TestCase):
    def test_real_files_parse_without_errors(self):
        for fn, cia, n in (("GLO.txt", "GLO", 3088), ("AZU.txt", "AZU", 1876), ("TAM.txt", "TAM", 5369)):
            r = parse_rpl(sample(fn))
            self.assertEqual(r.airline, cia)
            self.assertEqual(len(r.records), n)
            self.assertEqual(r.counts()["errors"], 0)
            self.assertEqual(r.header_validity_date, "2026-10-22")
            self.assertEqual((r.valid_from, r.valid_to), ("2026-10-22", "2026-10-28"))

    def test_fields_and_continuation(self):
        r = parse_rpl(sample("GLO.txt"))
        g = r.records[0]
        self.assertEqual((g.ident, g.type_icao, g.wake, g.adep, g.eobt, g.ades, g.eet, g.eet_min),
                         ("GLO1000", "B738", "M", "SBSP", "0925", "SBRJ", "0043", 43))
        self.assertEqual((g.valid_from, g.valid_to, g.days), ("2026-10-22", "2026-10-23", "0004500"))
        self.assertEqual(g.remarks_dict["PBN"], "B1C1D1O1S2T1")
        a = next(x for x in parse_rpl(sample("AZU.txt")).records if x.ident == "AZU2010")
        self.assertTrue(a.route.endswith("UL655 DIKAL DCT"), a.route)  # rota com 2 linhas de continuação
        self.assertEqual(len(a.raw_lines), 3)

    def test_malformed_records_are_flagged_not_dropped(self):
        hdr = ("CIA: XYZ                                    INÍCIO DE VALIDADE: 01nov.2026      PAG.: 1\r\n"
               "   VALIDO VALIDO DIAS OP  IDENT  TIPO   ADEP     VEL   FL  ROTA                                DEST         OBSERVACOES\r\n")
        def line(vf, vt, days, ident, adep, eobt, dest):
            return f"   {vf} {vt} {days} {ident:<7} A320/M {adep}{eobt} N0450 340 {'DCT':<35} {dest} EQPT/S\r\n"
        txt = hdr + line("011126", "071126", "1234567", "XYZ100", "SBGR", "1000", "SBRJ0050") \
            + line("011126", "071126", "1234567", "XYZ100", "SBGR", "1000", "SBRJ0050") \
            + line("071126", "011126", "1200000", "XYZ101", "SBGR", "1000", "SBRJ0050") \
            + line("011126", "071126", "1300000", "XYZ102", "SBGR", "1000", "SBRJ0050") \
            + line("011126", "071126", "1000000", "XYZ103", "SBGR", "2500", "SBRJ0050") \
            + line("011126", "071126", "1000000", "XYZ104", "SBGR", "1000", "SBGR0050") \
            + "   011126 071126 10000 QUEBRADO\r\n"
        r = parse_rpl(txt.encode("utf-8"))
        codes = {rec.ident or "?": {i.code for i in rec.issues} for rec in r.records}
        self.assertEqual(len(r.records), 7)
        self.assertIn("duplicado", codes["XYZ100"])
        self.assertIn("periodo", codes["XYZ101"])
        self.assertIn("dias", codes["XYZ102"])
        self.assertIn("eobt", codes["XYZ103"])
        self.assertIn("mesmo_aerodromo", codes["XYZ104"])
        self.assertIn("formato", codes["?"])
        self.assertEqual(r.airline, "XYZ")


class AppTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app(cls.tmp, testing=True)
        cls.c = cls.app.test_client()
        r = cls.c.post("/api/rpl/import-samples")
        assert r.status_code == 200, r.json
        assert cls.c.post("/api/fleet/demo").status_code == 200

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def ac(self, reg):
        return next(a for a in self.c.get("/api/aircraft?status=all").json["items"] if a["registration"] == reg)

    def gen(self, **p):
        r = self.c.post("/api/schedules/generate", json=p)
        self.assertEqual(r.status_code, 200, r.json)
        return r.json

    def assert_continuous(self, s, min_turn=None):
        legs = s["legs"]
        min_turn = min_turn if min_turn is not None else s["params"]["min_turn"]
        for a, b in zip(legs, legs[1:]):
            self.assertEqual(b["adep"], a["ades"], f"{a['flight_number']}→{b['flight_number']}")
            self.assertGreaterEqual((utc(b["dep_utc"]) - utc(a["arr_utc"])).total_seconds() / 60, min_turn)
            self.assertEqual(a["aircraft_id"], b["aircraft_id"])


class ImportTests(AppTestCase):
    def test_duplicate_file_rejected(self):
        r = self.c.post("/api/rpl/import-samples").json
        self.assertTrue(all(not x["ok"] and "já foi importado" in x["error"] for x in r["results"]))

    def test_sncp_identified(self):
        flags = self.c.get("/api/review").json["items"]
        self.assertFalse(any(f["code"] == "aeroporto_desconhecido" and "SNCP" in f["message"] for f in flags))
        ap = {a["icao"]: a for a in self.c.get("/api/meta").json["airports"]}
        self.assertEqual(ap["SNCP"]["iata"], "EEA")
        self.assertAlmostEqual(ap["SBSP"]["lat"], -23.63, places=1)

    def test_flights_query_by_operating_date(self):
        d = self.c.get("/api/rpl/flights?airline=GLO&q=GLO1000&date=2026-10-24").json
        self.assertEqual(d["total"], 1)
        self.assertEqual(d["items"][0]["type_icao"], "B737")  # em 24/10 o GLO1000 é B737

    def test_occurrences_real_and_projected(self):
        r = self.c.get("/api/rpl/occurrences?airline=TAM&date=2026-10-22").json
        self.assertTrue(r["items"] and all(o["origin"] == "REAL" for o in r["items"]))
        r = self.c.get("/api/rpl/occurrences?airline=TAM&date=2026-11-05").json  # quinta fora da validade
        self.assertTrue(r["items"] and all(o["origin"] == "PROJETADO" and o["ref_date"] == "2026-10-22"
                                           for o in r["items"]))
        r = self.c.get("/api/rpl/occurrences?airline=TAM&date=2026-11-05&projection=0").json
        self.assertEqual(r["items"], [])

    def test_search(self):
        res = self.c.get("/api/search?q=GLO1000").json["results"]
        self.assertTrue(any(x["kind"] == "voo" for x in res))


class GeneratorTests(AppTestCase):
    def test_weekly_inside_validity_is_all_real_and_continuous(self):
        t01 = self.ac("FIC-T01")
        s = self.gen(airline="TAM", kind="semanal", start_date="2026-10-22", aircraft_mode="specific",
                     aircraft_id=t01["id"], seed=1, base="SBGR", projection=False, reserve_blocks=0)
        self.assertGreater(len(s["legs"]), 10)
        self.assertTrue(all(l["data_origin"] == "REAL" for l in s["legs"]))
        self.assertTrue(all(l["planned_type"] == "A320" and l["registration"] == "FIC-T01" for l in s["legs"]))
        self.assertEqual(s["legs"][0]["adep"], "SBGR")
        self.assert_continuous(s)
        self.assertEqual(s["summary"]["errors"], 0)

    def test_used_flights_not_reused_and_aircraft_busy(self):
        a = self.gen(airline="GLO", kind="semanal", start_date="2026-10-22", aircraft_mode="auto",
                     icao_type="B738", seed=2)
        refs_a = {(l["flight_id"], l["dep_utc"][:10]) for l in a["legs"]}
        g2 = self.ac("FIC-G02")  # B38M
        c = self.gen(airline="GLO", kind="semanal", start_date="2026-10-22", aircraft_mode="specific",
                     aircraft_id=g2["id"], type_match="family", seed=4)
        refs_c = {(l["flight_id"], l["dep_utc"][:10]) for l in c["legs"]}
        self.assertFalse(refs_a & refs_c)
        # mesma aeronave automática não pode ser escolhida de novo no mesmo período
        r = self.c.post("/api/schedules/generate", json={"airline": "GLO", "kind": "semanal",
                                                         "start_date": "2026-10-22", "aircraft_mode": "auto",
                                                         "icao_type": "B738"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("já escalada", r.json["error"])  # só existe 1 B738 fictício

    def test_restrictions_blocked_airport_and_unavailability(self):
        t03 = self.ac("FIC-T03")
        self.c.put(f"/api/aircraft/{t03['id']}", json={"blocked_airports": "SBRJ, SBSP",
                                                      "unavailable": [{"from": "2026-10-24", "to": "2026-10-25",
                                                                       "reason": "manutenção"}]})
        s = self.gen(airline="TAM", kind="semanal", start_date="2026-10-22", aircraft_mode="specific",
                     aircraft_id=t03["id"], base="SBGR", seed=5)
        aps = {l["adep"] for l in s["legs"]} | {l["ades"] for l in s["legs"]}
        self.assertFalse(aps & {"SBRJ", "SBSP"})
        self.assertFalse([l for l in s["legs"] if l["local_date"] in ("2026-10-24", "2026-10-25")])
        self.assertTrue(any(d["code"] == "indisponivel" for d in s["diagnostics"]))
        self.assert_continuous(s)

    def test_monthly_projection_marks_legs(self):
        s = self.gen(airline="AZU", kind="mensal", month="2026-11", aircraft_mode="type_only", icao_type="E295",
                     seed=6, return_to_base="daily", base="SBKP")
        self.assertGreater(len(s["legs"]), 30)
        self.assertTrue(all(l["data_origin"] == "PROJETADO" and l["ref_date"] for l in s["legs"]))
        self.assertTrue(any(d["code"] == "projecao" for d in s["diagnostics"]))
        self.assert_continuous(s)

    def test_equipment_requirement_auto_selection(self):
        fields = {f["key"]: f["id"] for f in self.c.get("/api/config-fields").json["items"] if f["airline"] == "TAM"}
        s = self.gen(airline="TAM", kind="avulsa", start_date="2026-10-27", end_date="2026-10-27",
                     aircraft_mode="auto", equipment={str(fields["DRAMS"]): "SIM"}, seed=7)
        self.assertEqual(s["aircraft"]["registration"], "FIC-T02")  # única com DRAMS = SIM
        r = self.c.post("/api/schedules/generate", json={"airline": "TAM", "kind": "avulsa", "start_date": "2026-10-27",
                                                         "aircraft_mode": "auto",
                                                         "equipment": {str(fields["ROW_ROPS"]): "SIM",
                                                                       str(fields["DRAMS"]): "SIM"}})
        self.assertEqual(r.status_code, 400)  # T02 tem ROW/ROPS = NÃO; DESCONHECIDO nunca vale SIM

    def test_edit_regenerate_and_exports(self):
        t04 = self.ac("FIC-T04")
        s = self.gen(airline="TAM", kind="avulsa", start_date="2026-10-23", end_date="2026-10-26",
                     aircraft_mode="specific", aircraft_id=t04["id"], seed=8, base="SBGR")
        sid = s["id"]
        self.assertGreaterEqual(len(s["legs"]), 4)
        # excluir uma perna do meio cria quebra de continuidade sinalizada
        mid = s["legs"][1]
        s2 = self.c.delete(f"/api/legs/{mid['id']}").json
        self.assertTrue(any(c["code"] == "quebra_continuidade" for l in s2["legs"] for c in l["checks"]))
        # substituir pela alternativa que mantém continuidade resolve
        nxt = s2["legs"][1]
        alts = self.c.get(f"/api/legs/{nxt['id']}/alternatives?mode=replace").json
        fit = [c for c in alts["candidates"] if c["fits_next"] and c["type_ok"]]
        if fit:
            s3 = self.c.post(f"/api/schedules/{sid}/legs", json={"ref": fit[0]["ref"],
                                                                "replace_leg_id": nxt["id"]}).json
            self.assertEqual(s3["legs"][1]["adep"], s3["legs"][0]["ades"])
        # regerar a partir da 2ª perna: continuidade restaurada
        s4 = self.c.post(f"/api/schedules/{sid}/regenerate", json={"from_leg_id": s2["legs"][1]["id"]}).json
        self.assert_continuous(s4["schedule"])
        # regerar um dia no meio preserva vizinhos
        day = s4["schedule"]["legs"][len(s4["schedule"]["legs"]) // 2]["local_date"]
        s5 = self.c.post(f"/api/schedules/{sid}/regenerate", json={"day": day}).json["schedule"]
        for a, b in zip(s5["legs"], s5["legs"][1:]):
            self.assertEqual(b["adep"], a["ades"])
        # perna manual inexistente no RPL é sinalizada
        last = s5["legs"][-1]
        dep = utc(last["arr_utc"]) + timedelta(hours=2)
        s6 = self.c.post(f"/api/schedules/{sid}/legs", json={
            "flight_number": "TAM9999", "adep": last["ades"], "ades": "SBGR",
            "dep_utc": dep.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "arr_utc": (dep + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")}).json
        man = s6["legs"][-1]
        self.assertEqual(man["data_origin"], "MANUAL")
        self.assertTrue(any(c["code"] == "manual_nao_consta" for c in man["checks"]))
        csv = self.c.get(f"/api/schedules/{sid}/export.csv").data.decode("utf-8-sig")
        self.assertIn("seq;data_local;companhia;voo;matricula", csv.splitlines()[0])
        self.assertIn("FIC-T04", csv)
        ics = self.c.get(f"/api/schedules/{sid}/export.ics").data.decode()
        self.assertEqual(ics.count("BEGIN:VEVENT"), len(s6["legs"]))
        self.assertIn("UID:", ics)

    def test_weekday_limits_and_crew_rules(self):
        s = self.gen(airline="GLO", kind="mensal", month="2026-11", aircraft_mode="type_only", icao_type="B737",
                     base="SBGR", weekday_max={"1": 1, "3": 0}, crew_mode="rbac117", legs_max=6, seed=21,
                     avoid_used=False)
        by = {}
        for l in s["legs"]:
            by[l["local_date"]] = by.get(l["local_date"], 0) + 1
        self.assertTrue(all(n <= 1 for d, n in by.items() if date.fromisoformat(d).weekday() == 1))
        self.assertFalse([d for d in by if date.fromisoformat(d).weekday() == 3])
        cr = s["crew"]
        self.assertEqual(cr["summary"]["errors"], 0, cr["violations"] + [i for d in cr["duties"] for i in d["issues"]])
        for d in cr["duties"]:
            self.assertLessEqual(d["duty_h"], d["fdp_limit_h"])
            self.assertLessEqual(d["block_h"], d["flight_limit_h"])
            if d["rest_before_h"] is not None:
                self.assertGreaterEqual(d["rest_before_h"], d["rest_required_h"])
        self.assertLessEqual(cr["summary"]["block_h"], 80)
        self.assertGreaterEqual(cr["summary"]["months"]["2026-11"]["off"], 10)
        self.assertLessEqual(cr["summary"]["max_consecutive"], 6)
        # perfil Lei estrita: no máximo 4 pousos e 9 h de jornada
        s2 = self.gen(airline="GLO", kind="semanal", start_date="2026-11-02", aircraft_mode="type_only",
                      icao_type="B737", crew_mode="lei", legs_max=8, seed=22, avoid_used=False)
        self.assertTrue(all(d["legs"] <= 4 and d["duty_h"] <= 9 for d in s2["crew"]["duties"]))

    def test_validation_errors(self):
        r = self.c.post("/api/schedules/generate", json={"airline": "TAM", "kind": "semanal", "start_date": "x"})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/schedules/generate", json={"airline": "TAM", "kind": "avulsa",
                                                         "start_date": "2026-10-22", "end_date": "2027-03-01"})
        self.assertEqual(r.status_code, 400)


class FleetTests(AppTestCase):
    def test_fleet_import_reimport_and_conflicts(self):
        path = os.path.join(SAMPLES, "frota", "frota_ficticia_LATAM.txt")
        with open(path, "rb") as fh:
            data = fh.read()
        import io
        pv = self.c.post("/api/fleet/preview", data={"file": (io.BytesIO(data), "frota_ficticia_LATAM.txt")},
                         content_type="multipart/form-data").json
        self.assertEqual(pv["airline_guess"], "TAM")
        self.assertEqual(pv["mapping"]["MATRICULA"], "registration")
        self.assertTrue(pv["mapping"]["ISIS"].startswith("field:"))
        st = self.c.post("/api/fleet/apply", json={"token": pv["token"], "mapping": pv["mapping"],
                                                   "airline": "TAM", "options": {}}).json
        self.assertEqual((st["created"], st["duplicates_in_file"]), (6, 1))
        l06 = self.ac("FIC-L06")
        self.assertIsNone(l06["model_id"])  # "ATR 72" ambíguo: não associa
        l02 = self.ac("FIC-L02")
        vals = {v["key"]: v["value"] for v in l02["config"].values()}
        self.assertEqual(vals["DDRMI"], "DESCONHECIDO")  # N/A não vira SIM nem NÃO
        self.assertEqual(vals["ISIS"], "NÃO")  # 1ª ocorrência prevalece sobre a duplicada
        # edição manual + reimportação: não sobrescreve e cria conflito
        fid = next(k for k, v in l02["config"].items() if v["key"] == "ISIS")
        self.c.put(f"/api/aircraft/{l02['id']}", json={"config": {fid: "SIM"}})
        pv = self.c.post("/api/fleet/preview", data={"file": (io.BytesIO(data), "frota_ficticia_LATAM.txt")},
                         content_type="multipart/form-data").json
        st = self.c.post("/api/fleet/apply", json={"token": pv["token"], "mapping": pv["mapping"],
                                                   "airline": "TAM", "options": {}}).json
        self.assertEqual(st["created"], 0)
        self.assertEqual(st["conflicts"], 1)
        a = self.c.get(f"/api/aircraft/{l02['id']}").json
        self.assertEqual(a["config"][fid]["value"], "SIM")
        flag = next(f for f in a["flags"] if f["code"] == "conflito_config" and not f["resolved"])
        self.c.post(f"/api/review/{flag['id']}/resolve", json={"action": "keep_current"})
        hist = self.c.get(f"/api/aircraft/{l02['id']}/history").json["items"]
        self.assertTrue(any(h["action"] == "config" and h["source"] == "manual" for h in hist))
        self.assertTrue(a["raw_records"])

    def test_block_format_and_new_fields(self):
        import io
        with open(os.path.join(SAMPLES, "frota", "frota_ficticia_GOL_blocos.txt"), "rb") as fh:
            data = fh.read()
        pv = self.c.post("/api/fleet/preview", data={"file": (io.BytesIO(data), "lista.txt"), "airline": "GLO"},
                         content_type="multipart/form-data").json
        self.assertEqual(pv["format"], "blocos")
        self.assertEqual(pv["mapping"]["WIFI"], "new_field")
        st = self.c.post("/api/fleet/apply", json={"token": pv["token"], "mapping": pv["mapping"], "airline": "GLO",
                                                   "options": {}}).json
        self.assertEqual(st["created"], 3)
        x2 = self.ac("FIC-X02")
        self.assertEqual(x2["icao_type"], "B38M")
        self.assertTrue(any(f["key"] == "WIFI" and f["airline"] == "GLO"
                            for f in self.c.get("/api/config-fields").json["items"]))

    def test_registration_only_list_with_filename_attributes(self):
        import io
        from aeroscale.fleet import filename_attributes
        self.assertEqual(filename_attributes("PR-GXA___Collins__27K__SFP_2.0_ISFD.txt"),
                         ["Collins", "27K", "SFP 2.0", "ISFD"])
        data = b"PR-ZZA\r\nPR-ZZB\r\nPR-ZZC\r\n"  # matrículas inventadas só para o teste
        fn = "PR-ZZA - Collins (27K) SFP 2.0 ISFD.txt"
        pv = self.c.post("/api/fleet/preview", data={"file": (io.BytesIO(data), fn)},
                         content_type="multipart/form-data").json
        self.assertEqual((pv["format"], pv["row_count"]), ("lista de matrículas", 3))
        self.assertEqual(pv["list_attributes"], ["Collins", "27K", "SFP 2.0", "ISFD"])
        # sem modelo: o gerador explica o motivo
        self.c.post("/api/fleet/apply", json={"token": pv["token"], "mapping": pv["mapping"], "airline": "AZU",
                                              "options": {}})
        r = self.c.post("/api/schedules/generate", json={"airline": "AZU", "kind": "semanal",
                                                         "start_date": "2026-10-22", "aircraft_mode": "auto",
                                                         "icao_type": "A321"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("sem modelo", r.json["error"])
        # companhia errada + modelo corrigidos em lote
        ids = [a["id"] for a in self.c.get("/api/aircraft?airline=AZU&no_model=1").json["items"]
               if a["registration"].startswith("PR-ZZ")]
        self.assertEqual(len(ids), 3)
        self.c.post("/api/aircraft/bulk", json={"ids": ids, "airline": "GLO"})
        mid = next(m["id"] for m in self.c.get("/api/models?airline=GLO").json["items"] if m["icao_type"] == "B737")
        r = self.c.post("/api/aircraft/bulk", json={"ids": ids, "model_id": mid})
        self.assertEqual(r.status_code, 200)
        # reimportar com modelo e atributos comuns
        pv = self.c.post("/api/fleet/preview", data={"file": (io.BytesIO(data), fn)},
                         content_type="multipart/form-data").json
        attrs = [{"label": "Aviônica", "kind": "text", "value": "Collins"}, {"label": "ISFD", "kind": "tri"}]
        st = self.c.post("/api/fleet/apply", json={"token": pv["token"], "mapping": pv["mapping"], "airline": "GLO",
                                                   "options": {"default_model_id": mid, "list_attributes": attrs}}).json
        self.assertEqual((st["created"], st["updated"]), (0, 3))
        a = self.ac("PR-ZZB")
        self.assertEqual((a["airline"], a["icao_type"]), ("GLO", "B737"))
        self.assertEqual({v["label"]: v["value"] for v in a["config"].values()}, {"Aviônica": "Collins", "ISFD": "SIM"})

    def test_duplicate_registration_and_filters(self):
        r = self.c.post("/api/aircraft", json={"airline": "TAM", "registration": "fic-t01"})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/aircraft", json={"airline": "GLO", "registration": "przzx"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json["registration"], "PR-ZZX")
        fields = {f["key"]: f["id"] for f in self.c.get("/api/config-fields").json["items"] if f["airline"] == "TAM"}
        items = self.c.get(f"/api/aircraft?airline=TAM&eq={fields['ISIS']}:SIM").json["items"]
        self.assertTrue(items and all(a["config"][str(fields["ISIS"])]["value"] == "SIM" for a in items))
        csv = self.c.get("/api/aircraft/export.csv?airline=TAM").data.decode("utf-8-sig")
        self.assertIn("ISIS [TAM/A320]", csv.splitlines()[0])


# ------------------------------------------------------------------ Google (servidor falso)
class FakeGoogle(BaseHTTPRequestHandler):
    events: dict = {}
    seq = [0]
    calls: list = []

    def log_message(self, *a):
        pass

    def _send(self, code, obj=None):
        body = json.dumps(obj or {}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n).decode() if n else ""

    def do_POST(self):
        u = urlparse(self.path)
        FakeGoogle.calls.append(("POST", u.path))
        if u.path == "/token":
            form = parse_qs(self._body())
            assert form["grant_type"][0] in ("refresh_token", "authorization_code")
            return self._send(200, {"access_token": "tok", "expires_in": 3600, "refresh_token": "ref"})
        if u.path == "/revoke":
            return self._send(200, {})
        if u.path == "/calendars":
            return self._send(200, {"id": "aeroscale@group", "summary": json.loads(self._body())["summary"]})
        if u.path.endswith("/events"):
            ev = json.loads(self._body())
            FakeGoogle.seq[0] += 1
            ev["id"] = f"ev{FakeGoogle.seq[0]}"
            FakeGoogle.events[ev["id"]] = ev
            return self._send(200, ev)
        self._send(404, {"error": {"message": "not found"}})

    def do_PUT(self):
        u = urlparse(self.path)
        FakeGoogle.calls.append(("PUT", u.path))
        eid = u.path.rsplit("/", 1)[1]
        if eid not in FakeGoogle.events:
            return self._send(404, {"error": {"message": "Not Found"}})
        ev = json.loads(self._body())
        ev["id"] = eid
        FakeGoogle.events[eid] = ev
        self._send(200, ev)

    def do_DELETE(self):
        u = urlparse(self.path)
        FakeGoogle.calls.append(("DELETE", u.path))
        eid = u.path.rsplit("/", 1)[1]
        if FakeGoogle.events.pop(eid, None) is None:
            return self._send(410, {"error": {"message": "Gone"}})
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if self.headers.get("Authorization") != "Bearer tok":
            return self._send(401, {"error": {"message": "unauthorized"}})
        if u.path.endswith("/calendarList"):
            return self._send(200, {"items": [{"id": "primary@x", "summary": "Principal", "primary": True}]})
        if u.path.endswith("/events"):
            k, v = q["privateExtendedProperty"][0].split("=", 1)
            items = [e for e in FakeGoogle.events.values()
                     if e.get("extendedProperties", {}).get("private", {}).get(k) == v]
            return self._send(200, {"items": items})
        self._send(404, {"error": {"message": "nf"}})


class GoogleTests(AppTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeGoogle)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{cls.srv.server_port}"
        os.environ.update(AEROSCALE_GOOGLE_AUTH_URL=base + "/auth", AEROSCALE_GOOGLE_TOKEN_URL=base + "/token",
                          AEROSCALE_GOOGLE_API=base + "/calendar/v3")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        for k in ("AEROSCALE_GOOGLE_AUTH_URL", "AEROSCALE_GOOGLE_TOKEN_URL", "AEROSCALE_GOOGLE_API"):
            os.environ.pop(k, None)
        super().tearDownClass()

    def test_oauth_and_sync_without_duplicates(self):
        import io
        cred = json.dumps({"web": {"client_id": "cid.apps.googleusercontent.com", "client_secret": "sec",
                                   "redirect_uris": ["http://localhost:5000/api/google/callback"]}}).encode()
        r = self.c.post("/api/google/credentials", data={"file": (io.BytesIO(cred), "c.json")},
                        content_type="multipart/form-data")
        self.assertEqual(r.status_code, 200)
        r = self.c.get("/api/google/auth")
        self.assertEqual(r.status_code, 302)
        loc = r.headers["Location"]
        q = parse_qs(urlparse(loc).query)
        self.assertEqual(q["code_challenge_method"], ["S256"])
        self.assertEqual(q["access_type"], ["offline"])
        r = self.c.get(f"/api/google/callback?state={q['state'][0]}&code=abc")
        self.assertIn("google_ok=1", r.headers["Location"])
        self.assertTrue(self.c.get("/api/google/status").json["connected"])
        self.assertEqual(self.c.get("/api/google/calendars").json["items"][0]["id"], "primary@x")

        t01 = self.ac("FIC-T01")
        s = self.gen(airline="TAM", kind="avulsa", start_date="2026-10-22", end_date="2026-10-23",
                     aircraft_mode="specific", aircraft_id=t01["id"], seed=11)
        n = len(s["legs"])
        rep = self.c.post(f"/api/schedules/{s['id']}/google-sync", json={"calendar_id": "primary@x"}).json
        self.assertEqual((rep["created"], rep["errors"]), (n, []))
        ev = next(iter(FakeGoogle.events.values()))
        self.assertIn("timeZone", ev["start"])
        self.assertIn("Matrícula: FIC-T01", ev["description"])
        rep = self.c.post(f"/api/schedules/{s['id']}/google-sync", json={"calendar_id": "primary@x"}).json
        self.assertEqual((rep["created"], rep["unchanged"]), (0, n))
        # alterar e excluir pernas
        self.c.put(f"/api/legs/{s['legs'][0]['id']}", json={"notes": "nota nova"})
        self.c.delete(f"/api/legs/{s['legs'][-1]['id']}")
        rep = self.c.post(f"/api/schedules/{s['id']}/google-sync", json={"calendar_id": "primary@x"}).json
        self.assertEqual((rep["updated"], rep["deleted"], rep["created"]), (1, 1, 0))
        self.assertEqual(len(FakeGoogle.events), n - 1)
        # vínculos locais perdidos: reencontra pelos extendedProperties, sem duplicar
        import sqlite3
        con = sqlite3.connect(self.app.config["DATABASE"])
        con.execute("DELETE FROM gcal_events")
        con.commit()
        con.close()
        rep = self.c.post(f"/api/schedules/{s['id']}/google-sync", json={"calendar_id": "primary@x"}).json
        self.assertEqual(rep["created"], 0)
        self.assertEqual(len(FakeGoogle.events), n - 1)
        rep = self.c.post(f"/api/schedules/{s['id']}/google-remove", json={"calendar_id": "primary@x"}).json
        self.assertEqual(rep["deleted"], n - 1)
        # reserva vira evento de dia inteiro e acompanha o novo sorteio
        r = self.gen(airline="AZU", kind="semanal", start_date="2026-10-22", aircraft_mode="type_only",
                     icao_type="A20N", base="SBKP", seed=3, avoid_used=False, reserve_blocks=1)
        res = r.get("reserves") or self.c.get(f"/api/schedules/{r['id']}").json["reserves"]
        self.assertEqual(len(res), 1)
        rep = self.c.post(f"/api/schedules/{r['id']}/google-sync", json={"calendar_id": "primary@x"}).json
        self.assertEqual(rep["errors"], [])
        allday = [e for e in FakeGoogle.events.values() if "date" in e["start"]]
        self.assertEqual(len(allday), 1)
        self.assertIn("RESERVA", allday[0]["summary"])
        self.assertEqual(allday[0]["start"]["date"], res[0]["start_date"])
        self.c.post(f"/api/schedules/{r['id']}/reserve/redraw", json={})
        rep = self.c.post(f"/api/schedules/{r['id']}/google-sync", json={"calendar_id": "primary@x"}).json
        self.assertGreaterEqual(rep["deleted"], 1)
        self.assertEqual(len([e for e in FakeGoogle.events.values() if "date" in e["start"]]), 1)
        self.assertEqual(self.c.post("/api/google/disconnect").status_code, 200)
        self.assertFalse(self.c.get("/api/google/status").json["connected"])


class BackupTests(AppTestCase):
    def test_backup_roundtrip_to_new_install(self):
        import io
        self.gen(airline="TAM", kind="avulsa", start_date="2026-10-22", end_date="2026-10-23",
                 aircraft_mode="type_only", icao_type="A321", seed=31)
        data = self.c.get("/api/backup/export").data
        tmp2 = tempfile.mkdtemp()
        try:
            c2 = create_app(tmp2, testing=True).test_client()
            r = c2.post("/api/backup/import", data={"file": (io.BytesIO(data), "b.zip")},
                        content_type="multipart/form-data")
            self.assertEqual(r.status_code, 200, r.json)
            self.assertEqual(r.json["counts"]["rpl_imports"], 3)
            self.assertEqual(len(c2.get("/api/schedules").json["items"]),
                             len(self.c.get("/api/schedules").json["items"]))
            self.assertEqual(c2.get("/api/rpl/imports/1/original").status_code, 200)
            self.assertTrue(c2.get("/api/backup/points").json["items"])
            bad = c2.post("/api/backup/import", data={"file": (io.BytesIO(b"nope"), "x.zip")},
                          content_type="multipart/form-data")
            self.assertEqual(bad.status_code, 400)
        finally:
            shutil.rmtree(tmp2, ignore_errors=True)


# ------------------------------------------------------------------ METAR (servidor falso)
class FakeWx(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        import time as _t
        now = int(_t.time()) // 3600 * 3600
        if u.path.endswith("/metar"):
            ids = q["ids"][0].split(",")
            data = []
            if "SBGR" in ids:
                hh = datetime.fromtimestamp(now, timezone.utc).strftime("%d%H00Z")
                data.append({"icaoId": "SBGR", "obsTime": now, "rawOb": f"METAR SBGR {hh} 16002KT 9999 SCT009 OVC023 17/15 Q1021",
                             "fltCat": "MVFR", "name": "Sao Paulo Intl"})
            body = json.dumps(data).encode()
            ctype = "application/json"
        elif u.path.endswith("/taf"):
            body = json.dumps([{"icaoId": "SBGR", "issueTime": "2026-10-28T22:17:00.000Z", "validTimeFrom": now,
                                "validTimeTo": now + 30 * 3600, "rawTAF": "TAF SBGR 282217Z 2900/3006 10005KT 6000 RA "
                                "BKN008 BECMG 2902/2904 9999 NSW BKN012"}]).encode()
            ctype = "application/json"
        elif u.path.endswith("SBKP.TXT"):
            t = datetime.fromtimestamp(now - 3 * 3600, timezone.utc)
            body = f"{t:%Y/%m/%d %H:%M}\nSBKP {t:%d%H%M}Z 33018G30KT 2000 TSRA FEW030CB BKN040 24/20 Q1008\n".encode()
            ctype = "text/plain"
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class WeatherPredictTests(AppTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.wx = ThreadingHTTPServer(("127.0.0.1", 0), FakeWx)
        threading.Thread(target=cls.wx.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{cls.wx.server_port}"
        os.environ.update(AEROSCALE_AWC_URL=base + "/api/data", AEROSCALE_NOAA_URL=base + "/stations")

    @classmethod
    def tearDownClass(cls):
        cls.wx.shutdown()
        cls.wx.server_close()
        os.environ.pop("AEROSCALE_AWC_URL", None)
        os.environ.pop("AEROSCALE_NOAA_URL", None)
        super().tearDownClass()

    def test_decoder(self):
        from aeroscale.weather import decode_metar
        d = decode_metar("SPECI SBGL 281745Z 18015G28KT 140V220 3000 +TSRA BR FEW020CB BKN030 22/21 Q1009 WS R10")
        self.assertEqual((d["wind"]["dir"], d["wind"]["gust_kt"], d["wind"]["var_from"]), (180, 28, 140))
        self.assertEqual((d["visibility"]["m"], d["ceiling_ft"], d["qnh_hpa"], d["flight_category"]), (3000, 3000, 1009, "IFR"))
        self.assertTrue(any("Trovoada" in a["text"] for a in d["alerts"]))
        self.assertEqual(decode_metar("METAR SBSP 282300Z 12003KT 9999 BKN007 OVC036 16/16 Q1021")["flight_category"], "IFR")
        self.assertEqual(decode_metar("METAR SBBR 281300Z 33005KT CAVOK 27/10 Q1015 NOSIG")["flight_category"], "VFR")

    def test_metar_sources_cache_and_failure(self):
        r = self.c.get("/api/weather/metar?ids=SBGR,SBKP,SBZZ&force=1").json["items"]
        by = {x["icao"]: x for x in r}
        self.assertEqual(by["SBGR"]["source"], "aviationweather.gov")
        self.assertEqual(by["SBGR"]["freshness"]["status"], "atual")
        self.assertEqual(by["SBKP"]["source"], "NOAA tgftp")  # reserva
        self.assertEqual(by["SBKP"]["freshness"]["status"], "desatualizado")
        self.assertFalse(by["SBZZ"]["available"])
        self.assertIn("sem METAR", by["SBZZ"]["error"])
        t = self.c.get("/api/weather/taf?ids=SBGR&force=1").json["items"][0]
        self.assertTrue(t["available"] and t["valid_now"])
        self.assertEqual(len(t["taf"]["segments"]), 2)
        # API fora do ar: devolve o cache marcado com erro
        os.environ["AEROSCALE_AWC_URL"] = "http://127.0.0.1:1/api/data"
        os.environ["AEROSCALE_NOAA_URL"] = "http://127.0.0.1:1/stations"
        try:
            g = self.c.get("/api/weather/metar?ids=SBGR&force=1").json["items"][0]
            self.assertTrue(g["available"])
            self.assertTrue(g["error"])
        finally:
            base = f"http://127.0.0.1:{self.wx.server_port}"
            os.environ.update(AEROSCALE_AWC_URL=base + "/api/data", AEROSCALE_NOAA_URL=base + "/stations")

    def test_prediction_and_quality(self):
        r = self.c.get("/api/predict/next?airline=GLO&ident=G31854&date=2026-10-27&type=B738").json
        top = r["items"][0]["candidates"][0]
        self.assertEqual(top["ident"], "GLO1855")  # bate-volta GIG-NVT-GIG com número consecutivo
        self.assertTrue(any(x["feature"] == "pair_return" for x in top["reasons"]))
        q = self.c.get("/api/predict/quality").json
        self.assertGreaterEqual(q["transitions"], 60)
        self.assertGreater(q["top3_rate"], 0.5)

    def test_briefing_and_annotations(self):
        s = self.gen(airline="AZU", kind="avulsa", start_date="2026-10-27", end_date="2026-10-28",
                     aircraft_mode="type_only", icao_type="A20N", base="SBKP", seed=41, avoid_used=False)
        g = self.c.get(f"/api/schedules/{s['id']}").json
        self.assertTrue(g["legs"][0]["model_next"] is not None and g["legs"][0]["gap_next"] is not None)
        b = self.c.get(f"/api/legs/{g['legs'][0]['id']}/briefing").json
        self.assertEqual(b["leg"]["id"], g["legs"][0]["id"])
        self.assertIn("metar", b["weather"])
        self.assertTrue(b["prediction"]["candidates"])
        self.assertTrue(b["rpl"]["route"])
        h = self.c.get(f"/api/legs/{g['legs'][0]['id']}/briefing.html")
        self.assertEqual(h.status_code, 200)
        self.assertIn(b"Meteorologia", h.data)
        d = self.c.get(f"/api/schedules/{s['id']}/briefing?date=2026-10-27").json
        self.assertEqual(d["day"], "2026-10-27")


class AnomalySimbriefTests(AppTestCase):
    def test_repetition_is_an_anomaly(self):
        from aeroscale.scheduler import repeat_excess
        legs = [{"adep": "SBBR", "ades": "SBSP"}, {"adep": "SBSP", "ades": "SBBR"}, {"adep": "SBBR", "ades": "SBSP"},
                {"adep": "SBSP", "ades": "SBCF"}]
        self.assertEqual(repeat_excess(legs), 1)
        self.assertEqual(repeat_excess(legs[:2]), 0)  # um bate-volta é normal
        s = self.gen(airline="TAM", kind="semanal", start_date="2026-10-22", aircraft_mode="type_only",
                     icao_type="A320", base="SBBR", seed=3, avoid_used=False, anomaly_repeat_pct=0)
        by = {}
        for l in s["legs"]:
            by.setdefault(l["local_date"], []).append(l)
        self.assertTrue(all(repeat_excess(v) == 0 for v in by.values()))
        self.assertEqual(s["summary"]["anomalies"], 0)
        g = self.c.get(f"/api/schedules/{s['id']}").json
        self.assertIn("simbrief", g["legs"][0])

    def test_validation_flags_repetition(self):
        s = self.gen(airline="GLO", kind="avulsa", start_date="2026-10-27", end_date="2026-10-27",
                     aircraft_mode="type_only", icao_type="B738", base="SBSP", seed=5, avoid_used=False)
        # três pernas manuais SBSP–SBRJ num dia sem outras pernas: só a 3ª é anormalidade
        for k, (o, d) in enumerate((("SBSP", "SBRJ"), ("SBRJ", "SBSP"), ("SBSP", "SBRJ"))):
            r = self.c.post(f"/api/schedules/{s['id']}/legs", json={
                "flight_number": f"GLO9{k}00", "adep": o, "ades": d,
                "dep_utc": f"2026-10-30T{13 + 2 * k}:00Z", "arr_utc": f"2026-10-30T{13 + 2 * k}:55Z"})
            self.assertEqual(r.status_code, 200, r.json)
        g = self.c.get(f"/api/schedules/{s['id']}").json
        flagged = [l for l in g["legs"] if any(c["code"] == "anormalidade_repeticao" for c in l["checks"])]
        self.assertEqual([l["flight_number"] for l in flagged], ["GLO9200"])
        self.assertEqual(g["summary"]["anomalies"], 1)

    def test_simbrief_link(self):
        from urllib.parse import parse_qs, urlparse
        s = self.gen(airline="GLO", kind="avulsa", start_date="2026-10-27", end_date="2026-10-27",
                     aircraft_mode="type_only", icao_type="B738", base="SBSP", seed=7, avoid_used=False)
        leg = s["legs"][0]
        b = self.c.get(f"/api/legs/{leg['id']}/simbrief").json
        u = urlparse(b["url"])
        self.assertEqual(u.netloc, "dispatch.simbrief.com")
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        self.assertEqual(q["airline"], "GLO")
        self.assertEqual(q["fltnum"], leg["flight_number"][3:])
        self.assertEqual((q["orig"], q["dest"], q["type"]), (leg["adep"], leg["ades"], "B738"))
        self.assertTrue(q["route"] and q["fl"].isdigit() and int(q["fl"]) % 100 == 0)
        self.assertIn("EQPT/", q["extrarmk"])
        self.assertIn("OPR/GLO", q["extrarmk"])
        self.assertTrue(q.get("altn") and q["altn"] not in (leg["adep"], leg["ades"]))
        self.assertRegex(q["date"], r"^\d{2}[A-Z]{3}\d{2}$")
        # ajustes manuais
        b2 = self.c.get(f"/api/legs/{leg['id']}/simbrief?altn=SBKP&fl=FL350").json
        self.assertEqual((b2["params"]["altn"], b2["params"]["fl"]), ("SBKP", 35000))
        self.assertEqual(self.c.get(f"/api/legs/{leg['id']}/simbrief?altn=XX").status_code, 400)
        # alternado fixo por destino tem prioridade
        self.c.put("/api/settings", json={"simbrief_alternates": f"{leg['ades']}=SBGR"})
        try:
            b3 = self.c.get(f"/api/legs/{leg['id']}/simbrief").json
            self.assertEqual((b3["params"]["altn"], b3["alternate"]["source"]), ("SBGR", "fixo"))
        finally:
            self.c.put("/api/settings", json={"simbrief_alternates": {}})
        self.assertEqual(self.c.put("/api/settings", json={"simbrief_alternates": "SBGR=SBGR"}).status_code, 400)

    def test_alternate_suggestion(self):
        from aeroscale import simbrief
        from aeroscale.db import connect
        db = connect(self.app.config["DATABASE"])
        a = simbrief.suggest_alternate(db, "SBGR", "SBPA", "GLO", "B738")
        self.assertEqual(a["source"], "sugerido")
        self.assertIn(a["icao"], ("SBKP", "SBSP", "SBSJ"))
        self.assertLessEqual(a["distance_km"], 150)



# ------------------------------------------------------------------ ADS-B (servidor falso do GitHub)
class FakeAdsb(BaseHTTPRequestHandler):
    FILES: dict = {}

    def log_message(self, *a):
        pass

    def do_GET(self):
        data = self.FILES.get(self.path)
        if data is None:
            self.send_response(404)
            self.end_headers()
            return
        rng = self.headers.get("Range")
        if rng:
            lo, hi = rng.split("=")[1].split("-")
            lo, hi = int(lo), min(int(hi), len(data) - 1)
            chunk = data[lo:hi + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {lo}-{hi}/{len(data)}")
        else:
            chunk = data
            self.send_response(200)
        self.send_header("Content-Length", str(len(chunk)))
        self.end_headers()
        self.wfile.write(chunk)


def _build_day_tar(traces: dict[str, dict], big_mb: int = 9) -> bytes:
    import gzip as _gz
    import io as _io
    import tarfile as _tar
    buf = _io.BytesIO()
    with _tar.open(fileobj=buf, mode="w") as tf:
        def add(name, payload):
            ti = _tar.TarInfo(name)
            ti.size = len(payload)
            tf.addfile(ti, _io.BytesIO(payload))
        add("./README.txt", b"teste")
        add("./heatmap/01.bin.ttf", os.urandom(big_mb << 20))  # trecho grande que deve ser pulado
        for hx, tr in traces.items():
            add(f"./traces/{hx[-2:]}/trace_full_{hx}.json", _gz.compress(json.dumps(tr).encode()))
        add("./traces/ab/trace_full_a1b2ab.json", _gz.compress(json.dumps(
            {"icao": "a1b2ab", "r": "N123", "timestamp": 0, "trace": [[0, 1, 1, 1000, 1, 1, 0, 0, {"flight": "GLO9999 "}]]}).encode()))
    return buf.getvalue()


class AdsbTests(AppTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeAdsb)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        os.environ["AEROSCALE_ADSB_URL"] = f"http://127.0.0.1:{cls.srv.server_port}" + "/{year}/{tag}.tar.{part}"
        # rastro sintético: uma aeronave da GOL fazendo dois voos reais do RPL em sequência em 27/10
        occ = cls.c.get("/api/rpl/occurrences?airline=GLO&date=2026-10-27").json["items"]
        by_adep = {}
        for o in occ:
            by_adep.setdefault(o["adep"], []).append(o)
        chain = None
        for a in occ:
            if a["type_icao"] != "B738":
                continue
            nxt = [b for b in by_adep.get(a["ades"], []) if 45 * 60 <= (utc(b["dep"]) - utc(a["arr"])).total_seconds() <= 3 * 3600]
            if nxt:
                chain = (a, nxt[0])
                break
        cls.chain = chain
        t0 = int(utc("2026-10-27T00:00:00Z").timestamp())
        pts = []
        for o in chain:
            for t in (utc(o["dep"]) + timedelta(minutes=10), utc(o["arr"]) - timedelta(minutes=10)):
                pts.append([t.timestamp() - t0, -23.0, -46.0, 20000, 400, 90, 0, 0, {"flight": o["ident"] + " "}])
        traces = {"e48e09": {"icao": "e48e09", "r": "PR-GXD", "t": "B738", "desc": "BOEING 737-800",
                             "timestamp": t0, "trace": pts}}
        data = _build_day_tar(traces)
        half = len(data) // 2
        tag = "v2026.10.27-planes-readsb-prod-0"
        FakeAdsb.FILES = {f"/2026/{tag}.tar.aa": data[:half], f"/2026/{tag}.tar.ab": data[half:]}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        os.environ.pop("AEROSCALE_ADSB_URL", None)
        super().tearDownClass()

    def _run(self, **body):
        import time as _t
        r = self.c.post("/api/adsb/jobs", json=body)
        self.assertEqual(r.status_code, 200, r.json)
        for _ in range(200):
            j = self.c.get("/api/adsb/jobs/current").json
            if j["state"] != "running":
                return j
            _t.sleep(0.05)
        self.fail("tarefa ADS-B não terminou")

    def test_scan_match_fleet_and_weights(self):
        from aeroscale import adsb
        j = self._run(**{"from": "2026-10-27", "to": "2026-10-27"})
        self.assertEqual(j["state"], "finished", j)
        self.assertEqual(j["done"], ["2026-10-27"])
        s = self.c.get("/api/adsb/summary").json
        self.assertEqual(s["days"][0]["aircraft"], 1)  # o N123 (fora do bloco brasileiro) é ignorado
        self.assertEqual(s["airlines"][0]["airline"], "GLO")
        self.assertEqual(s["legs_rpl"], 2)
        self.assertLess(s["days"][0]["mb"], 9)  # o trecho de 9 MB foi pulado sem baixar
        legs = self.c.get("/api/adsb/aircraft/e48e09/legs").json["legs"]
        self.assertEqual([l["callsign"] for l in legs], [o["ident"] for o in self.chain])
        self.assertEqual(legs[1]["gap_before"]["kind"], "solo")
        # dia já processado é pulado; dia não publicado falha com mensagem clara
        j2 = self._run(**{"from": "2026-10-26", "to": "2026-10-27"})
        self.assertEqual(j2["skipped"], ["2026-10-27"])
        self.assertIn("ainda não publicou", j2["failed"][0]["error"])
        # transição observada entra na avaliação do modelo
        st = self.c.get("/api/adsb/stats").json
        self.assertEqual(st["transitions"], 1)
        self.assertEqual(st["real"]["GLO"]["aircraft"], 1)
        self.assertEqual(self.c.post("/api/adsb/calibrate").status_code, 400)  # poucas transições
        # frota
        r = self.c.post("/api/adsb/to-fleet", json={"airline": "GLO"}).json
        self.assertEqual(r["created"], 1)
        ac = self.ac("PR-GXD")
        self.assertEqual(ac["icao_type"], "B738")
        self.assertEqual(self.c.post("/api/adsb/to-fleet", json={}).json["created"], 0)
        csv_txt = self.c.get("/api/adsb/aircraft.csv").data.decode("utf-8-sig")
        self.assertIn("GLO;PR-GXD;B738", csv_txt)
        # pesos calibrados aplicados mudam o modelo usado nas previsões
        w = dict(adsb.predict.WEIGHTS, overnight=9.0)
        self.assertEqual(self.c.post("/api/adsb/weights", json={"weights": {"GLO": w}}).status_code, 200)
        q = self.c.get("/api/predict/quality").json
        self.assertEqual(q["weights_by_airline"]["GLO"]["overnight"], 9.0)
        self.c.post("/api/adsb/weights", json={"weights": {}})
        self.assertEqual(self.c.delete("/api/adsb/days/2026-10-27").json["aircraft_removed"], 1)

    def test_fit_weights_recovers_signal(self):
        from aeroscale import adsb
        # dados sintéticos: o candidato verdadeiro sempre tem pair_return=1 e pouco solo
        data = []
        for i in range(120):
            X = [{"pair_return": 1.0, "turn_slope": 0.0}, {"pair_return": 0.0, "turn_slope": -1.5},
                 {"pair_return": 0.0, "turn_slope": 0.0}]
            data.append({"X": X, "true": 0 if i % 5 else 2})
        w = adsb.fit_weights(data, {"pair_return": 0.0, "turn_slope": 0.0}, l2=0.1)
        self.assertGreater(w["pair_return"], 1.0)
        self.assertGreater(w["turn_slope"], 0.0)

    def test_callsign_runs(self):
        from aeroscale import adsb
        tr = {"timestamp": 1000, "trace": [
            [0, 0, 0, "ground", 0, 0, 0, 0, {"flight": "GLO1000 "}], [60, 0, 0, 3000, 200, 0, 0, 0, None],
            [120, 0, 0, 30000, 400, 0, 0, 0, {"flight": "@@@@@@@@"}], [3600, 0, 0, 2000, 200, 0, 0, 0, None],
            [7200, 0, 0, 2000, 200, 0, 0, 0, {"flight": "GLO1001 "}], [7300, 0, 0, 1000, 150, 0, 0, 0, None],
            [7400, 0, 0, 1000, 150, 0, 0, 0, {"flight": "PTB2000 "}], [7500, 0, 0, 1000, 150, 0, 0, 0, None]]}
        rs = adsb.callsign_runs(tr, ("GLO",))
        self.assertEqual([(r["callsign"], r["points"]) for r in rs], [("GLO1000", 4), ("GLO1001", 2)])
        self.assertEqual(rs[0]["alt0"], 0)


class TextExportTests(AppTestCase):
    def test_plain_text_schedule(self):
        import re as _re
        from aeroscale.scheduler import _flight_digits
        self.assertEqual((_flight_digits("TAM3376"), _flight_digits("G31855"), _flight_digits(None)), ("3376", "1855", "POS"))
        s = self.gen(airline="TAM", kind="avulsa", start_date="2026-10-28", end_date="2026-11-03",
                     aircraft_mode="type_only", icao_type="A320", base="SBGR", seed=4, avoid_used=False)
        txt = self.c.get(f"/api/schedules/{s['id']}/text").json["text"]
        lines = txt.strip().split("\n")
        self.assertEqual(lines[0], "ESCALA DE OUTUBRO:")
        self.assertIn("ESCALA DE NOVEMBRO:", lines)
        days = [l for l in lines if l.startswith("(")]
        self.assertEqual(len(days), 7)  # 28/10 a 03/11, um dia por linha
        self.assertTrue(all(_re.fullmatch(r"\(\d{2}\) (FOLGA|[A-Z]{3}(?:[-/ ]+[A-Z]{3,4})+ \((?:\d+|POS)(?:,(?:\d+|POS))*\))", l) for l in days), days)
        # cada dia com voo bate com as pernas da escala
        g = self.c.get(f"/api/schedules/{s['id']}").json
        first = [l for l in g["legs"] if l["local_date"] == "2026-10-28"]
        self.assertTrue(days[0].endswith("(" + ",".join(l["flight_number"][3:] for l in first) + ")"))
        self.assertNotIn("DO", [l.split(" ", 1)[1] for l in days])
        r = self.c.get(f"/api/schedules/{s['id']}/export.txt")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"\r\n", r.data)


class ReserveTests(AppTestCase):
    def test_draw_bounds_location_and_activation_rates(self):
        from aeroscale import reserve
        start, end = date(2026, 11, 1), date(2026, 11, 30)
        durs, base_n, act_n = [], 0, 0
        for seed in range(1, 401):
            p = {"reserve_blocks": 1, "reserve_seed": seed, "reserve_min_days": 3, "reserve_max_days": 9,
                 "reserve_base_pct": 80, "reserve_activation_pct": 50, "reserve_activation_max_days": 3}
            blocked = {date(2026, 11, 10), date(2026, 11, 11)}
            b, _w = reserve.draw(p, start, end, blocked, "SBGR", ["SBGR", "SBKP", "SBRF"])
            b = b[0]
            durs.append(b["days"])
            self.assertEqual((b["end_date"] - b["start_date"]).days + 1, b["days"])
            days = {b["start_date"] + timedelta(days=i) for i in range(b["days"])}
            self.assertFalse(days & blocked)
            base_n += b["location_kind"] == "base"
            act_n += b["activated"]
            if b["activated"]:
                self.assertTrue(b["start_date"] <= b["act_start"] <= b["end_date"])
                self.assertLessEqual(b["act_start"] + timedelta(days=b["act_days"] - 1), b["end_date"])
            else:
                self.assertIsNone(b["act_start"])
            if b["location_kind"] == "outro":
                self.assertIn(b["location"], ("SBKP", "SBRF"))
        self.assertEqual((min(durs), max(durs)), (3, 9))
        self.assertTrue(0.72 < base_n / 400 < 0.88, base_n)
        self.assertTrue(0.42 < act_n / 400 < 0.58, act_n)
        # semana com 5 dias livres: nunca passa do que cabe nem fica abaixo de 3
        wk = [reserve.draw({"reserve_blocks": 1, "reserve_seed": s, "reserve_min_days": 3, "reserve_max_days": 9,
                            "reserve_base_pct": 80, "reserve_activation_pct": 50}, date(2026, 10, 26),
                           date(2026, 11, 1), {date(2026, 10, 31), date(2026, 11, 1)}, "SBGR", [])[0][0]["days"]
              for s in range(1, 60)]
        self.assertTrue(all(3 <= d <= 5 for d in wk))
        # sem 3 dias seguidos livres: não inventa bloco menor
        b, w = reserve.draw({"reserve_blocks": 1, "reserve_seed": 1}, date(2026, 10, 26), date(2026, 10, 28),
                            {date(2026, 10, 27)}, "SBGR", [])
        self.assertEqual(b, [])
        self.assertTrue(w)

    def _sched(self, **kw):
        base = dict(airline="AZU", kind="semanal", start_date="2026-10-22", aircraft_mode="type_only",
                    icao_type="A20N", base="SBKP", avoid_used=False, reserve_blocks=1)
        base.update(kw)
        s = self.gen(**base)
        return self.c.get(f"/api/schedules/{s['id']}").json

    def test_activation_legs_real_and_return_to_location(self):
        found = False
        for seed in range(1, 12):
            g = self._sched(seed=seed, reserve_activation_pct=100, reserve_base_pct=100)
            r = g["reserves"][0]
            self.assertTrue(3 <= r["days"] <= 7)
            self.assertEqual(r["location"], "SBKP")
            act = [l for l in g["legs"] if l["activity"] == "RESERVA"]
            inside = [l for l in g["legs"] if r["start_date"] <= l["local_date"] <= r["end_date"]]
            self.assertEqual({l["id"] for l in inside}, {l["id"] for l in act})  # nada além do acionamento na reserva
            self.assertFalse(any(c["code"] == "quebra_continuidade" for l in g["legs"] for c in l["checks"]))
            if r["status"] == "acionado":
                found = True
                self.assertTrue(act)
                self.assertEqual(act[0]["adep"], r["location"])
                self.assertEqual(act[-1]["ades"], r["location"])
                self.assertTrue(all(l["data_origin"] in ("REAL", "PROJETADO") and l["flight_id"] for l in act))
                self.assertTrue(all(l["reserve_id"] == r["id"] for l in act))
                self.assertEqual(sorted(r["legs"]), sorted(l["id"] for l in act))
            else:
                self.assertEqual(r["status"], "inviavel")
                self.assertFalse(act)
        self.assertTrue(found)

    def test_no_activation_and_persistence(self):
        g = self._sched(seed=5, reserve_activation_pct=0)
        r = g["reserves"][0]
        self.assertEqual((r["status"], r["status_label"]), ("sem_acionamento", "NÃO ACIONADO"))
        self.assertFalse([l for l in g["legs"] if l["activity"] == "RESERVA"])
        # reabrir não sorteia de novo
        g2 = self.c.get(f"/api/schedules/{g['id']}").json
        self.assertEqual(g2["reserves"][0]["uid"], r["uid"])
        # regerar um dia fora da reserva mantém o sorteio; dentro da reserva é recusado
        outside = next((l["local_date"] for l in g["legs"] if not (r["start_date"] <= l["local_date"] <= r["end_date"])), None)
        if outside:
            self.c.post(f"/api/schedules/{g['id']}/regenerate", json={"day": outside})
            self.assertEqual(self.c.get(f"/api/schedules/{g['id']}").json["reserves"][0]["uid"], r["uid"])
        bad = self.c.post(f"/api/schedules/{g['id']}/regenerate", json={"day": r["start_date"]})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("reserva", bad.json["error"])
        # novo sorteio e regerar tudo trocam o resultado salvo
        self.c.post(f"/api/schedules/{g['id']}/reserve/redraw", json={})
        r2 = self.c.get(f"/api/schedules/{g['id']}").json["reserves"][0]
        self.assertNotEqual(r2["uid"], r["uid"])
        self.c.post(f"/api/schedules/{g['id']}/regenerate", json={})
        r3 = self.c.get(f"/api/schedules/{g['id']}").json["reserves"][0]
        self.assertNotEqual(r3["uid"], r2["uid"])
        # mesma semente = mesma reserva
        a = self._sched(seed=77, reserve_activation_pct=0)["reserves"][0]
        b = self._sched(seed=77, reserve_activation_pct=0)["reserves"][0]
        self.assertEqual((a["start_date"], a["days"], a["location"]), (b["start_date"], b["days"], b["location"]))

    def test_infeasible_activation_is_recorded_without_inventing(self):
        # 1 perna por dia e acionamento de 1 dia: impossível sair e voltar ao local no mesmo dia
        g = self._sched(seed=9, reserve_activation_pct=100, reserve_activation_max_days=1,
                        weekday_max={str(i): 1 for i in range(7)}, crew_days_off=False)
        r = g["reserves"][0]
        self.assertEqual(r["status"], "inviavel")
        self.assertIn("Nenhum voo foi inventado", r["note"])
        self.assertFalse([l for l in g["legs"] if l["activity"] == "RESERVA"])
        self.assertTrue(any(d["code"] == "reserva_inviavel" for d in g["diagnostics"]))

    def test_monthly_blocks_respect_unavailability_and_exports(self):
        t03 = self.ac("FIC-T03")
        self.c.put(f"/api/aircraft/{t03['id']}", json={"unavailable": [{"from": "2026-11-05", "to": "2026-11-08",
                                                                        "reason": "manutenção"}]})
        s = self.gen(airline="TAM", kind="mensal", month="2026-11", aircraft_mode="specific", aircraft_id=t03["id"],
                     base="SBGR", seed=21, reserve_blocks=2)
        g = self.c.get(f"/api/schedules/{s['id']}").json
        self.assertEqual(len(g["reserves"]), 2)
        a, b = g["reserves"]
        self.assertLess(a["end_date"], b["start_date"])
        for r in g["reserves"]:
            self.assertTrue(3 <= r["days"] <= 9)
            self.assertFalse(r["start_date"] <= "2026-11-08" and r["end_date"] >= "2026-11-05")
        offs = set(g["params"]["planned_days_off"])
        for r in g["reserves"]:
            d = date.fromisoformat(r["start_date"])
            while d.isoformat() <= r["end_date"]:
                self.assertNotIn(d.isoformat(), offs)
                d += timedelta(days=1)
        txt = self.c.get(f"/api/schedules/{s['id']}/text").json["text"]
        self.assertIn(f"RESERVA: {a['start_date'][8:10]}/{a['start_date'][5:7]} a {a['end_date'][8:10]}/{a['end_date'][5:7]} ({a['days']} dias)", txt)
        self.assertIn("Acionamento:", txt)
        self.assertIn(f"RESERVA {a['location_iata']}", txt)
        ics = self.c.get(f"/api/schedules/{s['id']}/export.ics").data.decode()
        self.assertEqual(ics.count("DTSTART;VALUE=DATE:"), 2)
        csv_txt = self.c.get(f"/api/schedules/{s['id']}/export.csv").data.decode("utf-8-sig")
        self.assertIn(";RESERVA;", csv_txt)
        cal = self.c.get(f"/api/calendar?from=2026-11-01&to=2026-11-30&schedule_id={s['id']}").json
        self.assertEqual(len(cal["reserves"]), 2)
        # outra escala da mesma aeronave não pode usar o período (voos ou reserva)
        r = self.c.post("/api/schedules/generate", json={"airline": "TAM", "kind": "semanal", "start_date": a["start_date"],
                                                         "aircraft_mode": "auto", "icao_type": "A320", "model_id": None})
        if r.status_code == 200:
            self.assertNotEqual(r.json.get("aircraft_id"), t03["id"])
        self.c.put(f"/api/aircraft/{t03['id']}", json={"unavailable": []})



class RplFolderTests(unittest.TestCase):
    def test_autoimport_on_startup_and_skip_deleted(self):
        tmp = tempfile.mkdtemp()
        rdir = os.path.join(tmp, "rpl")
        os.makedirs(rdir)
        shutil.copy(os.path.join(ROOT, "rpl", "TAM.txt"), rdir)
        with open(os.path.join(rdir, "LEIA-ME.txt"), "w") as fh:
            fh.write("ignorado")
        os.environ["AEROSCALE_RPL_DIR"] = rdir
        try:
            app = create_app(os.path.join(tmp, "data"), testing=False)
            c = app.test_client()
            imps = c.get("/api/rpl/imports").json["imports"]
            self.assertEqual([i["airline"] for i in imps], ["TAM"])
            app2 = create_app(os.path.join(tmp, "data"), testing=False)  # segunda abertura não duplica
            self.assertEqual(len(app2.test_client().get("/api/rpl/imports").json["imports"]), 1)
            self.assertEqual(c.delete(f"/api/rpl/imports/{imps[0]['id']}").status_code, 200)
            app3 = create_app(os.path.join(tmp, "data"), testing=False)  # apagado de propósito não volta
            self.assertEqual(app3.test_client().get("/api/rpl/imports").json["imports"], [])
            r = app3.test_client().post("/api/rpl/import-samples").json  # o botão importa mesmo assim
            self.assertTrue(r["results"][0]["ok"])
        finally:
            os.environ.pop("AEROSCALE_RPL_DIR", None)
            shutil.rmtree(tmp, ignore_errors=True)
