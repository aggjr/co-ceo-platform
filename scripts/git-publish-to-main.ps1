# Depois de commitar na branch da maquina: integra em main, unifica versao e realinha a branch local.
# Uso (na raiz, com working tree limpa apos o commit):
#   .\scripts\git-publish-to-main.ps1
#
# Config (uma vez):
#   git config coceo.integrationBranch main
#   git config coceo.machineBranch note-gamer
#   # ou note-guto | antigravity-gamer | antigravity-guto
# Branches de maquina: scripts/git-machines.json

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

function Read-MachineBranchesFromConfig {
  $cfgPath = Join-Path $PSScriptRoot "git-machines.json"
  if (-not (Test-Path $cfgPath)) { return @() }
  $cfg = Get-Content -Raw $cfgPath | ConvertFrom-Json
  return @($cfg.machineBranches | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}

function Resolve-PeerRemoteRefs {
  param([string]$MachineBranch)
  $refs = New-Object System.Collections.Generic.List[string]
  foreach ($b in (Read-MachineBranchesFromConfig)) {
    if ($b -ne $MachineBranch) {
      $refs.Add("origin/$b")
    }
  }
  $legacy = Read-PeerBranchFromEnv
  if ($legacy) { $refs.Add($legacy) }
  return @($refs | Select-Object -Unique)
}

function Test-GitRef($ref) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $null = git rev-parse --verify "$ref" 2>&1
  $ok = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $prev
  return $ok
}

$integration = git config --get coceo.integrationBranch
if (-not $integration) { $integration = "main" }
$machine = git config --get coceo.machineBranch
if (-not $machine) {
  Write-Error "Defina: git config coceo.machineBranch note-gamer | note-guto | antigravity-gamer | antigravity-guto"
}

$peerRefs = Resolve-PeerRemoteRefs -MachineBranch $machine

if (git status --porcelain) {
  Write-Error "Working tree suja. Faca o commit antes de publicar em main."
}

$current = git branch --show-current
if ($current -ne $machine) {
  Write-Host "Checkout $machine ..."
  git checkout $machine
}

Write-Host "=== 1/7 fetch ===" -ForegroundColor Cyan
git fetch origin

Write-Host "=== 2/7 alinhar $machine com origin/$integration ===" -ForegroundColor Cyan
git merge "origin/$integration" -m "merge($machine): integrar $integration antes de publicar"
if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "pre-push") { exit 1 }
  Write-Error "Falha ao integrar $integration em $machine"
}

Write-Host "=== 3/7 push $machine ===" -ForegroundColor Cyan
git push -u origin $machine

Write-Host "=== 4/7 merge $machine -> $integration ===" -ForegroundColor Cyan
git checkout $integration
git pull origin $integration
git merge $machine -m "merge($integration): integrar $machine"

if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "merge-em-main") { exit 1 }
  Write-Error "Falha no merge para $integration"
}

if ($peerRefs.Count -eq 0) {
  Write-Host "=== 5/7 nenhuma branch par (git-machines.json) ===" -ForegroundColor Cyan
} else {
  $peerIndex = 0
  foreach ($peer in $peerRefs) {
    $peerIndex += 1
    if (Test-GitRef $peer) {
      Write-Host "=== 5/7 merge par $peer -> $integration ===" -ForegroundColor Cyan
      git merge $peer -m "merge($integration): integrar $peer"
      if ($LASTEXITCODE -ne 0) {
        if (Show-Conflicts "merge-par-$peer") { exit 1 }
        Write-Error "Falha ao integrar branch par $peer"
      }
    } else {
      Write-Host "=== 5/7 par $peer ausente no remoto (ok) ===" -ForegroundColor Cyan
    }
  }
}

Write-Host "=== 6/7 bump versao unificada (sempre incrementa patch) ===" -ForegroundColor Cyan
$env:BUMP_VERSION = "1"
node scripts/bump-version.js --integrate
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha ao bump de versao unificada"
}

$versionJson = Get-Content -Raw version.json | ConvertFrom-Json
$appVersion = "V$($versionJson.major).$($versionJson.minor).$($versionJson.patch)"
git add version.json package.json src/generated/version.ts frontend/src/generated/version.js
git commit -m "chore(release): $appVersion - integracao main"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha ao commitar bump de versao"
}
Write-Host "Versao publicada: $appVersion" -ForegroundColor Green

Write-Host "=== 7/7 push $integration e realinhar $machine ===" -ForegroundColor Cyan
git push origin $integration

git checkout $machine
git merge "origin/$integration" -m "merge($machine): alinhar apos publicar em $integration"
if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "realinhar-maquina") { exit 1 }
  Write-Error "Falha ao realinhar $machine com $integration"
}

git push origin $machine

$sha = (git rev-parse --short HEAD).Trim()
$versionJson = Get-Content -Raw version.json | ConvertFrom-Json
$appVersion = "V$($versionJson.major).$($versionJson.minor).$($versionJson.patch)"
Write-Host ""
Write-Host "OK. main e $machine em $sha | versao $appVersion (sem conflitos pendentes)." -ForegroundColor Green
Write-Host "Tip: git log -1 --oneline" -ForegroundColor DarkGray
