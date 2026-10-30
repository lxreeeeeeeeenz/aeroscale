"""AeroScale – gerador de escalas realistas para simulação aérea."""
from __future__ import annotations

import os

from flask import Flask, send_from_directory

__version__ = "1.5.1"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def create_app(data_dir: str | None = None, testing: bool = False) -> Flask:
    from . import db
    from .api import bp

    data_dir = data_dir or os.environ.get("AEROSCALE_DATA") or os.path.join(BASE_DIR, "data")
    os.makedirs(data_dir, exist_ok=True)
    app = Flask(__name__, static_folder=os.path.join(BASE_DIR, "static"), static_url_path="/static")
    app.config.update(
        DATA_DIR=data_dir,
        DATABASE=os.path.join(data_dir, "aeroscale.db"),
        STORAGE_DIR=os.path.join(data_dir, "arquivos"),
        MAX_CONTENT_LENGTH=40 * 1024 * 1024,
        TESTING=testing,
        SECRET_KEY=_secret(data_dir),
        JSON_SORT_KEYS=False,
    )
    app.json.ensure_ascii = False
    db.init_db(app.config["DATABASE"])
    app.config["RPL_DIR"] = os.environ.get("AEROSCALE_RPL_DIR") or os.path.join(BASE_DIR, "rpl")
    if not testing:
        _autoimport_rpl(app)
    app.teardown_appcontext(db.close_db)
    app.register_blueprint(bp)

    @app.route("/")
    def index():
        resp = send_from_directory(app.static_folder, "index.html")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.after_request
    def no_cache_static(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        return resp

    return app


def _autoimport_rpl(app):
    """Na inicialização, importa os RPL novos colocados na pasta rpl/ (os já importados são ignorados)."""
    import json as _json
    from . import db
    from .rpl_service import import_folder
    conn = db.connect(app.config["DATABASE"])
    try:
        if not _json.loads((conn.execute("SELECT value FROM settings WHERE key='rpl_autoimport'").fetchone() or ["true"])[0]):
            return
        r = conn.execute("SELECT value FROM meta WHERE key='rpl_folder_skip'").fetchone()
        skip = set(_json.loads(r[0])) if r else set()
        res = import_folder(conn, app.config["RPL_DIR"], app.config["STORAGE_DIR"], skip)
        for x in res:
            if x.get("skipped"):
                continue
            print(f"  RPL {x['filename']}: " + (f"importado ({x.get('records', '?')} registros)" if x["ok"] else f"erro: {x['error']}"))
    except Exception as e:  # nunca impede o app de abrir
        print(f"  Aviso: importação automática da pasta rpl/ falhou: {e}")
    finally:
        conn.close()


def _secret(data_dir: str) -> str:
    p = os.path.join(data_dir, ".secret_key")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as fh:
            return fh.read().strip()
    import secrets
    key = secrets.token_hex(32)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(key)
    return key
