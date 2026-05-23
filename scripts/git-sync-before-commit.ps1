# Sincroniza a branch do agente com a integracao ANTES de commitar.
# Inclui deteccao de versao atrasada (version.json vs origin/main).
#
# Uso:
#   .\scripts\git-sync-before-commit.ps1
#
# Mesma estacao, dois agentes:
#   . .\scripts\set-agent-profile.ps1 antigravity-gamer

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$profileScript = Join-Path $PSScriptRoot "coceo-git-profile.ps1"
if (Test-Path $profileScript) {
  . $profileScript
  $integration = Get-CoCeoIntegrationBranch
  $machine = Assert-CoCeoMachineBranch
} else {
  $integration = git config --get coceo.integrationBranch
  if (-not $integration) { $integration = "main" }
  $machine = git config --get coceo.machineBranch
  if (-not $machine) {
    Write-Error "Defina: git config coceo.machineBranch antigravity-gamer (ou outra branch de trabalho)"
  }
}

Write-Host "Agente: $machine | Integracao: $integration" -ForegroundColor DarkGray

Write-Host "=== Verificar versao (origin/$integration) ===" -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "ensure-code-version.js")
if ($LASTEXITCODE -ne 0) {
  if ($LASTEXITCODE -eq 3) { exit 3 }
  exit $LASTEXITCODE
}

$current = git branch --show-current
if ($current -ne $machine) {
  Write-Host "Checkout $machine ..."
  git checkout $machine
}

Write-Host "OK. Branch alinhada com $integration. Pode commitar." -ForegroundColor Green
