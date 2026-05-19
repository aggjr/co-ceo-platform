# co-CEO Platform

Plataforma B2B multi-módulo (Core IAM/Cockpit, INVEST, …) — API Node.js + MySQL + frontend Vite.

## Requisitos

- Node.js 20+
- MySQL 8+

## Configuração

1. Copie `.env.example` para `.env` e preencha credenciais.
2. Execute as migrations em `src/database/migrations/` (ordem numérica) e `src/database/seeds/005_permissions_and_roles.sql`.
3. Seed do super admin:

```bash
set CO_CEO_ADMIN_PASSWORD=sua-senha
npx ts-node src/database/seeds/001_super_admin.ts
```

## Desenvolvimento

```bash
npm install
npm run dev
```

- API: http://localhost:3001  
- UI (Vite): http://localhost:5173 (proxy `/api` → 3001)

## Produção local

```bash
npm run build
npm start
```

Acesse http://localhost:3001 (API serve o frontend compilado).

## Login padrão (após seed)

- E-mail: `admin@coceo.com.br` (ou `CO_CEO_ADMIN_EMAIL`)
- Senha: valor de `CO_CEO_ADMIN_PASSWORD` no `.env`

## Documentação

Ver `docs/architecture/`.
