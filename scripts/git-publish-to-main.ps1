# Depois de commitar na branch da maquina: integra em main e realinha a branch local.
# Uso (na raiz, com working tree limpa apos o commit):
#   .\scripts\git-publish-to-main.ps1
#
# Config (uma vez):
#   git config coceo.integrationBranch main
#   git config coceo.machineBranch note-gamer

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Show-Conflicts {
  param([string]$Stage)
  $files = git diff --name-only --diff-filter=U 2>$null
  if ($files) {
    Write-Host ""
    Write-Host "CONFLITO ($Stage). Arquivos:" -ForegroundColor Red
    $files | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "Resolva, depois: git add <arquivos> && git commit" -ForegroundColor Yellow
    return $true
  }
  return $false
}

$integration = git config --get coceo.integrationBranch
if (-not $integration) { $integration = "main" }
$machine = git config --get coceo.machineBranch
if (-not $machine) {
  Write-Error "Defina: git config coceo.machineBranch note-gamer (ou note-guto)"
}

if (git status --porcelain) {
  Write-Error "Working tree suja. Faca o commit antes de publicar em main."
}

$current = git branch --show-current
if ($current -ne $machine) {
  Write-Host "Checkout $machine ..."
  git checkout $machine
}

Write-Host "=== 1/5 fetch ===" -ForegroundColor Cyan
git fetch origin

Write-Host "=== 2/5 alinhar $machine com origin/$integration ===" -ForegroundColor Cyan
git merge "origin/$integration" -m "merge($machine): integrar $integration antes de publicar"
if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "pre-push") { exit 1 }
  Write-Error "Falha ao integrar $integration em $machine"
}

Write-Host "=== 3/5 push $machine ===" -ForegroundColor Cyan
git push -u origin $machine

Write-Host "=== 4/5 merge $machine -> $integration ===" -ForegroundColor Cyan
git checkout $integration
git pull origin $integration
git merge $machine -m "merge($integration): integrar $machine"

if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "merge-em-main") { exit 1 }
  Write-Error "Falha no merge para $integration"
}

Write-Host "=== 5/5 push $integration e realinhar $machine ===" -ForegroundColor Cyan
git push origin $integration

git checkout $machine
git merge "origin/$integration" -m "merge($machine): alinhar apos publicar em $integration"
if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "realinhar-maquina") { exit 1 }
  Write-Error "Falha ao realinhar $machine com $integration"
}

git push origin $machine

$sha = (git rev-parse --short HEAD).Trim()
Write-Host ""
Write-Host "OK. main e $machine em $sha (sem conflitos pendentes)." -ForegroundColor Green
Write-Host "Tipos: git log -1 --oneline" -ForegroundColor DarkGray
