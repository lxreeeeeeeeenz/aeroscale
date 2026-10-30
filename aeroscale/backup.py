"""Backup e restauração completos (para reinstalar o Windows ou trocar de computador).

O arquivo .zip contém:
  manifest.json                  versão, data e contagens
  aeroscale.db                   banco SQLite (cópia consistente via API de backup do SQLite)
  arquivos/                      RPL e listas de frota originais importados
  google_client_secret.json      (opcional) credencial OAuth do Google
  google_token.json              (opcional) autorização da sua conta Google
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime

from .db import init_db, now_iso

REQUIRED_TABLES = {"settings", "airlines", "rpl_imports", "rpl_flights", "aircraft", "schedules", "schedule_legs"}
MAX_UNCOMPRESSED = 2 * 1024 ** 3  # 2 GB


def _counts(conn) -> dict:
    out = {}
    for t in ("rpl_imports", "rpl_flights", "aircraft", "config_fields", "schedules", "schedule_legs"):
        try:
            out[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        except sqlite3.Error:
            out[t] = None
    return out


def export_backup(cfg: dict, include_credentials=True, include_token=False) -> tuple[bytes, str]:
    from . import __version__
    tmpdir = tempfile.mkdtemp(prefix="aeroscale_bkp_")
    try:
        dbcopy = os.path.join(tmpdir, "aeroscale.db")
        src = sqlite3.connect(cfg["DATABASE"])
        dst = sqlite3.connect(dbcopy)
        with dst:
            src.backup(dst)
        counts = _counts(dst)
        dst.close()
        src.close()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(dbcopy, "aeroscale.db")
            storage = cfg["STORAGE_DIR"]
            if os.path.isdir(storage):
                for root, _dirs, files in os.walk(storage):
                    if os.path.basename(root) == "tmp":
                        continue
                    for fn in files:
                        full = os.path.join(root, fn)
                        rel = os.path.relpath(full, storage).replace(os.sep, "/")
                        if rel.startswith("tmp/"):
                            continue
                        z.write(full, "arquivos/" + rel)
            inc = []
            for name, flag in (("google_client_secret.json", include_credentials), ("google_token.json", include_token)):
                path = os.path.join(cfg["DATA_DIR"], name)
                if flag and os.path.exists(path):
                    z.write(path, name)
                    inc.append(name)
            z.writestr("manifest.json", json.dumps({
                "app": "AeroScale", "version": __version__, "created_at": now_iso(), "counts": counts,
                "includes": inc}, ensure_ascii=False, indent=2))
        name = f"aeroscale-backup-{datetime.now():%Y%m%d-%H%M}.zip"
        return buf.getvalue(), name
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def save_restore_point(cfg: dict, label="antes-de-restaurar") -> str:
    data, _ = export_backup(cfg, include_credentials=True, include_token=True)
    folder = os.path.join(cfg["DATA_DIR"], "backups")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{label}-{datetime.now():%Y%m%d-%H%M%S}.zip")
    with open(path, "wb") as fh:
        fh.write(data)
    # mantém só os 10 mais recentes
    pts = sorted(f for f in os.listdir(folder) if f.endswith(".zip"))
    for old in pts[:-10]:
        try:
            os.remove(os.path.join(folder, old))
        except OSError:
            pass
    return path


def list_restore_points(cfg: dict) -> list[dict]:
    folder = os.path.join(cfg["DATA_DIR"], "backups")
    if not os.path.isdir(folder):
        return []
    out = []
    for f in sorted(os.listdir(folder), reverse=True):
        if f.endswith(".zip"):
            p = os.path.join(folder, f)
            out.append({"name": f, "size": os.path.getsize(p),
                        "created_at": datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M")})
    return out


def restore_point_path(cfg: dict, name: str) -> str | None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+\.zip", name or ""):
        return None
    p = os.path.join(cfg["DATA_DIR"], "backups", name)
    return p if os.path.exists(p) else None


def import_backup(cfg: dict, data: bytes) -> dict:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("Arquivo inválido: envie o .zip gerado em Configurações → Backup.")
    names = z.namelist()
    if "aeroscale.db" not in names or "manifest.json" not in names:
        raise ValueError("Este .zip não é um backup do AeroScale (faltam aeroscale.db/manifest.json).")
    if sum(i.file_size for i in z.infolist()) > MAX_UNCOMPRESSED:
        raise ValueError("Backup grande demais.")
    for n in names:
        if n.startswith("/") or ".." in n.split("/") or ":" in n:
            raise ValueError("Backup com caminhos inválidos; restauração cancelada.")
    try:
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
    except Exception:
        raise ValueError("manifest.json ilegível.")
    if manifest.get("app") != "AeroScale":
        raise ValueError("O manifesto não é de um backup do AeroScale.")

    tmpdir = tempfile.mkdtemp(prefix="aeroscale_rst_")
    try:
        tmpdb = os.path.join(tmpdir, "aeroscale.db")
        with open(tmpdb, "wb") as fh:
            fh.write(z.read("aeroscale.db"))
        chk = sqlite3.connect(tmpdb)
        try:
            ok = chk.execute("PRAGMA integrity_check").fetchone()[0]
            tables = {r[0] for r in chk.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        except sqlite3.DatabaseError:
            raise ValueError("O banco dentro do backup está corrompido.")
        finally:
            chk.close()
        if ok != "ok":
            raise ValueError(f"O banco do backup não passou na verificação de integridade ({ok}).")
        missing = REQUIRED_TABLES - tables
        if missing:
            raise ValueError(f"Backup incompleto: faltam as tabelas {', '.join(sorted(missing))}.")

        point = save_restore_point(cfg)

        # copia o banco para o arquivo em uso pela API de backup do SQLite (funciona com o arquivo aberto
        # e evita o bloqueio de arquivos do Windows)
        src = sqlite3.connect(tmpdb)
        dst = sqlite3.connect(cfg["DATABASE"], timeout=30)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        init_db(cfg["DATABASE"])  # cria tabelas/colunas/configurações novas se o backup for antigo

        storage = cfg["STORAGE_DIR"]
        os.makedirs(storage, exist_ok=True)
        n_files = 0
        for n in names:
            if n.startswith("arquivos/") and not n.endswith("/"):
                rel = n[len("arquivos/"):]
                target = os.path.join(storage, *rel.split("/"))
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "wb") as fh:
                    fh.write(z.read(n))
                n_files += 1
        restored_google = []
        for gname in ("google_client_secret.json", "google_token.json"):
            if gname in names:
                with open(os.path.join(cfg["DATA_DIR"], gname), "wb") as fh:
                    fh.write(z.read(gname))
                restored_google.append(gname)

        # caminhos absolutos do computador antigo -> pasta atual
        conn = sqlite3.connect(cfg["DATABASE"])
        with conn:
            for table in ("rpl_imports", "fleet_imports"):
                for rid, sp in conn.execute(f"SELECT id, stored_path FROM {table}").fetchall():
                    if sp:
                        newp = os.path.join(storage, os.path.basename(sp.replace("\\", "/")))
                        conn.execute(f"UPDATE {table} SET stored_path=? WHERE id=?", (newp, rid))
            counts = _counts(conn)
        conn.close()
        from .rpl_service import _INDEX_CACHE
        _INDEX_CACHE.clear()
        return {"manifest": manifest, "counts": counts, "files": n_files, "google": restored_google,
                "restore_point": os.path.basename(point)}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def resolve_stored(cfg: dict, path: str | None) -> str | None:
    """Arquivo original salvo: tenta o caminho gravado e, se não existir, a pasta atual."""
    if not path:
        return None
    if os.path.exists(path):
        return path
    alt = os.path.join(cfg["STORAGE_DIR"], os.path.basename(path.replace("\\", "/")))
    return alt if os.path.exists(alt) else None
