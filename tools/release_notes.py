"""Imprime a seção de uma versão do CHANGELOG.md (usado pelo workflow de release).

  python tools/release_notes.py 1.5.1
"""
import os
import re
import sys

ver = sys.argv[1].lstrip("v")
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
text = open(os.path.join(root, "CHANGELOG.md"), encoding="utf-8").read()
m = re.search(rf"^## \[?{re.escape(ver)}\]?.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
if not m:
    sys.exit(f"Versão {ver} não encontrada no CHANGELOG.md")
print(m.group(1).strip())
print("\n---\n**Instalação (Windows):** baixe o `.zip` abaixo, extraia e dê dois cliques em `iniciar.bat` "
      "(precisa do Python 3.10+). Os RPL da pasta `rpl/` são importados na primeira abertura.")
