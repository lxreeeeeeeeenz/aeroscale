# Publicar o AeroScale no GitHub

O projeto já vem com o histórico do git, a tag da versão e os workflows do GitHub Actions:
- **Testes:** a cada envio para `main`, roda os testes no Windows e no Linux.
- **Release:** a cada tag `v*`, roda os testes, monta o `AeroScale-X.Y.Z.zip` e publica o release com as notas do `CHANGELOG.md`.

## 1. Criar o repositório (uma vez)
No GitHub: **New repository** → nome `aeroscale` → **sem** README, .gitignore ou licença (o projeto já tem) → *Create repository*.

## 2. Enviar o código e a tag
No PowerShell, dentro da pasta do AeroScale (troque `SEU_USUARIO`):

```powershell
git remote add origin https://github.com/SEU_USUARIO/aeroscale.git
git push -u origin main
git push origin v1.5.1
```

O envio da tag dispara o workflow **Release**. Em 2–3 minutos o release aparece em *Releases*, com o `.zip` e o `.sha256`.

> Sem o git instalado: use o **GitHub Desktop** → *File → Add local repository* → escolha a pasta → *Publish repository*. Depois, em *Repository → Push origin* e *Repository → Push tags* (ou crie o release manualmente na página do repositório, anexando o zip).

## 3. Trocar os RPL
Os três RPL ficam em `rpl/` (AZU.txt, GLO.txt, TAM.txt). Para atualizar:
1. Substitua os arquivos na pasta `rpl/`.
2. `git add rpl` → `git commit -m "RPL de <data>"`.
3. Suba a versão em `aeroscale/__init__.py`, adicione a seção no `CHANGELOG.md`, crie a tag (`git tag v1.5.2`) e envie (`git push origin main v1.5.2`).

## O que nunca vai para o GitHub
A pasta `data/` (banco, credencial e token do Google, backups) está no `.gitignore`. Seus dados e autorizações ficam só no seu computador.

## Licença
O repositório ainda não tem licença de uso do código. Sem uma, ninguém pode reutilizar o código legalmente. Se quiser liberar, adicione um arquivo `LICENSE` (por exemplo, MIT) antes de tornar o repositório público.
