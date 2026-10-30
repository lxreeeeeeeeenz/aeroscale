"""Ponto de entrada.

  python app.py                       abre o AeroScale em http://localhost:5000
  python app.py --backup ARQUIVO.zip  gera um backup completo e sai
  python app.py --restore ARQUIVO.zip restaura um backup (cria ponto de restauração antes) e sai
"""
import os
import sys
import threading
import webbrowser

from aeroscale import create_app

app = create_app()


def _arg(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        sys.exit(f"Informe o arquivo depois de {flag}.")
    return None


if __name__ == "__main__":
    from aeroscale import backup

    out = _arg("--backup")
    if out:
        data, _name = backup.export_backup(app.config, include_credentials=True, include_token=True)
        with open(out, "wb") as fh:
            fh.write(data)
        print(f"Backup salvo em {os.path.abspath(out)}")
        sys.exit(0)
    src = _arg("--restore")
    if src:
        with open(src, "rb") as fh:
            r = backup.import_backup(app.config, fh.read())
        print(f"Restaurado: {r['counts']}. Ponto de restauração anterior: {r['restore_point']}")
        sys.exit(0)

    port = int(os.environ.get("AEROSCALE_PORT", "5000"))
    url = f"http://localhost:{port}"
    print(f"\n  AeroScale rodando em {url}  (Ctrl+C para encerrar)\n")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
