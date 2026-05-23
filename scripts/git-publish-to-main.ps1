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

function Read-PeerBranchFromEnv {
  $envFile = Join-Path $PSScriptRoot "branch-peer.local.env"
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    if ($t -match "^PEER_BRANCH=(.+)$") { return $matches[1].Trim() }
  }
  return $null
}

function Test-GitRef($ref) {
  git rev-parse --verify "$ref" 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

$integration = git config --get coceo.integrationBranch
if (-not $integration) { $integration = "main" }
$machine = git config --get coceo.machineBranch
if (-not $machine) {
  Write-Error "Defina: git config coceo.machineBranch note-gamer (ou note-guto)"
}

$peer = Read-PeerBranchFromEnv
if (-not $peer) {
  if ($machine -eq "note-guto") { $peer = "origin/note-gamer" }
  elseif ($machine -eq "note-gamer") { $peer = "origin/note-guto" }
}

if (git status --porcelain) {
  Write-Error "Working tree suja. Faca o commit antes de publicar em main."
}

$current = git branch --show-current
if ($current -ne $machine) {
  Write-Host "Checkout $machine ..."
  git checkout $machine
}

Write-Host "=== 1/6 fetch ===" -ForegroundColor Cyan
git fetch origin

Write-Host "=== 2/6 alinhar $machine com origin/$integration ===" -ForegroundColor Cyan
git merge "origin/$integration" -m "merge($machine): integrar $integration antes de publicar"
if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "pre-push") { exit 1 }
  Write-Error "Falha ao integrar $integration em $machine"
}

Write-Host "=== 3/6 push $machine ===" -ForegroundColor Cyan
git push -u origin $machine

Write-Host "=== 4/6 merge $machine -> $integration ===" -ForegroundColor Cyan
git checkout $integration
git pull origin $integration
git merge $machine -m "merge($integration): integrar $machine"

if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "merge-em-main") { exit 1 }
  Write-Error "Falha no merge para $integration"
}

if ($peer -and (Test-GitRef $peer)) {
  Write-Host "=== 5/6 merge par $peer -> $integration ===" -ForegroundColor Cyan
  git merge $peer -m "merge($integration): integrar $peer"
  if ($LASTEXITCODE -ne 0) {
    if (Show-Conflicts "merge-par") { exit 1 }
    Write-Error "Falha ao integrar branch par $peer"
  }
} else {
  Write-Host "=== 5/6 par $peer ausente no remoto (ok) ===" -ForegroundColor Cyan
}

Write-Host "=== 6/6 push $integration e realinhar $machine ===" -ForegroundColor Cyan
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
