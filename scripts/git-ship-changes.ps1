# Commit na branch do agente + integracao em main + bump de versao (sem perguntar).
# Uso:
#   .\scripts\git-ship-changes.ps1 -Message "feat(invest): ajuste no grafico"
#   npm run git:ship -- -Message "fix(dal): corrige leitura"

param(
  [Parameter(Mandatory = $true)]
  [string]$Message
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$profileScript = Join-Path $PSScriptRoot "coceo-git-profile.ps1"
if (Test-Path $profileScript) {
  . $profileScript
  $machine = Assert-CoCeoMachineBranch
} else {
  $machine = git config --get coceo.machineBranch
  if (-not $machine) {
    Write-Error "Defina coceo.machineBranch ou COCEO_MACHINE_BRANCH"
  }
}

Write-Host "=== 1/4 Alinhar versao com origin/main ===" -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "ensure-code-version.js")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$current = git branch --show-current
if ($current -ne $machine) {
  git checkout $machine
}

if (-not (git status --porcelain)) {
  Write-Host "Nada a commitar (working tree limpa)." -ForegroundColor Yellow
} else {
  Write-Host "=== 2/4 Commit em $machine ===" -ForegroundColor Cyan
  # Apenas arquivos rastreados — evita subir scripts de diagnostico locais (??).
  git add -u
  git commit -m $Message
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha no commit"
  }
}

Write-Host "=== 3/4 Verificar superficies de versao (login + sidebar) ===" -ForegroundColor Cyan
npm run verify:version-ui
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 4/6 Integrar em main + bump obrigatorio de versao + build web ===" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "git-publish-to-main.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 5/6 Confirmar versao unificada em $machine ===" -ForegroundColor Cyan
node (Join-Path $PSScriptRoot "verify-integrate-version.js")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$versionJson = Get-Content -Raw version.json | ConvertFrom-Json
$finalVersion = "V$($versionJson.major).$($versionJson.minor).$($versionJson.patch)"
Write-Host "=== 6/6 OK - versao do sistema: $finalVersion ===" -ForegroundColor Green
