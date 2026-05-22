# DNS — `platform.co-ceo.com.br`

Subdomínio do domínio que você já possui (`co-ceo.com.br`). **Não** é compra de domínio novo.

## 1. EasyPanel (serviço `co-ceo-platform`)

1. Abra **co-ceo-platform** → **Domínios** (ou **Domains**).
2. Adicione: `platform.co-ceo.com.br`
3. Anote o destino que o EasyPanel indicar (hostname do servidor ou do proxy).

## 2. Cloudflare

1. Zona **co-ceo.com.br** → **DNS** → **Adicionar registro**
2. Tipo: **CNAME** (ou **A** se o EasyPanel passar IP fixo)
3. Nome: `platform`
4. Destino: hostname do EasyPanel (ex. do painel de domínios do serviço)
5. Proxy: **Proxied** (nuvem laranja) — SSL na borda Cloudflare
6. Salvar

Aguarde propagação (minutos a algumas horas).

## 3. Validar

- `https://platform.co-ceo.com.br/health` → `database: connected` (após MySQL)
- `https://platform.co-ceo.com.br/api/version`

## 4. `www` antigo

`www.co-ceo.com.br` pode continuar apontando para **co-ceo-app** sem alteração.
