# Publica branch de validação no GitHub (aggjr/co-ceo-platform).
# Execute no PowerShell, na raiz do projeto, com Git instalado.
param(
  [string]$Branch = "feat/invest-custody-validation-2026-05",
  [string]$Remote = "origin"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "Git não está no PATH. Instale: https://git-scm.com/download/win"
}

if (-not (Test-Path .git)) {
  git init
  git remote add origin https://github.com/aggjr/co-ceo-platform.git 2>$null
}

git add -A
git status

$msg = @"
feat(invest): custódia, extrato BTG, CALLs PRIO e correções para validação

- Cobertura CALL em ações (vendidas/sobrando/prêmio D+1)
- Strikes Profit e notional; tipo CALL/PUT na planilha opções
- Extrato BTG 18-19/05 e vendas PRIOF; remoção CDB autorizada
- Saldo caixa via soma do livro-razão; motor de caixa no CustodyEngine
- POST /api/invest/custody/apply-corrections e script invest-apply-corrections
- Testes unitários invest; ver VALIDATION_HANDOFF.md
"@

git commit -m $msg 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Nada novo para commit ou commit falhou. Verifique git status."
}

git checkout -B $Branch 2>$null
git push -u $Remote $Branch

Write-Host ""
Write-Host "Branch publicada: $Branch"
Write-Host "Abra PR em: https://github.com/aggjr/co-ceo-platform/compare/$Branch"
