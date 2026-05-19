# Versionamento Git — co-CEO Platform

## Pré-requisito

Instale o [Git for Windows](https://git-scm.com/download/win) e reinicie o terminal.

## Inicializar repositório (primeira vez)

```powershell
cd c:\co_ceo_platform
git init
git branch -M main
git add .
git status
git commit -m "feat: core API, gateway IAM, cockpit frontend Vite"
```

## Conectar ao remoto (GitHub / Azure DevOps)

```powershell
git remote add origin https://github.com/SUA_ORG/co-ceo-platform.git
git push -u origin main
```

## O que não sobe no Git

- `.env` (credenciais — use `.env.example` como modelo)
- `node_modules/`, `dist/`, `frontend/dist/`
