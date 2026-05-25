# Depois de commitar na branch da maquina: integra em main, unifica versao e realinha a branch local.
# Passo 6/8: bump-version.js --integrate SEMPRE incrementa patch + commit chore(release) — agentes nao devem bump manual.
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

$dirtyTracked = @(git status --porcelain | Where-Object { $_ -notmatch '^\?\?' })
if ($dirtyTracked.Count -gt 0) {
  Write-Error "Ha alteracoes commitadas pendentes. Faca commit antes de publicar em main."
}

$current = git branch --show-current
if ($current -ne $machine) {
  Write-Host "Checkout $machine ..."
  git checkout $machine
}

Write-Host "=== 1/8 fetch ===" -ForegroundColor Cyan
git fetch origin

Write-Host "=== 2/8 alinhar $machine com origin/$integration ===" -ForegroundColor Cyan
git merge "origin/$integration" -m "merge($machine): integrar $integration antes de publicar"
if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "pre-push") { exit 1 }
  Write-Error "Falha ao integrar $integration em $machine"
}

Write-Host "=== 3/8 push $machine ===" -ForegroundColor Cyan
git push -u origin $machine

Write-Host "=== 4/8 merge $machine -> $integration ===" -ForegroundColor Cyan
git checkout $integration
git pull origin $integration
git merge $machine -m "merge($integration): integrar $machine"

if ($LASTEXITCODE -ne 0) {
  if (Show-Conflicts "merge-em-main") { exit 1 }
  Write-Error "Falha no merge para $integration"
}

if ($peerRefs.Count -eq 0) {
  Write-Host "=== 5/8 nenhuma branch par (git-machines.json) ===" -ForegroundColor Cyan
} else {
  $peerIndex = 0
  foreach ($peer in $peerRefs) {
    $peerIndex += 1
    if (Test-GitRef $peer) {
      Write-Host "=== 5/8 merge par $peer -> $integration ===" -ForegroundColor Cyan
      git merge $peer -m "merge($integration): integrar $peer"
      if ($LASTEXITCODE -ne 0) {
        if (Show-Conflicts "merge-par-$peer") { exit 1 }
        Write-Error "Falha ao integrar branch par $peer"
      }
    } else {
      Write-Host "=== 5/8 par $peer ausente no remoto (ok) ===" -ForegroundColor Cyan
    }
  }
}

Write-Host "=== 6/8 bump versao unificada (OBRIGATORIO — incrementa patch) ===" -ForegroundColor Cyan
if ($env:BUMP_VERSION -eq "0") {
  Write-Error "BUMP_VERSION=0 proibido no integrate. A versao do sistema deve sempre subir neste passo."
}
$versionBefore = Get-Content -Raw version.json | ConvertFrom-Json
$patchBefore = [int]$versionBefore.patch
$semverBefore = "V$($versionBefore.major).$($versionBefore.minor).$($versionBefore.patch)"
Write-Host "Versao antes do bump: $semverBefore (patch=$patchBefore)" -ForegroundColor DarkGray

$env:BUMP_VERSION = "1"
node scripts/bump-version.js --integrate
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha ao bump de versao unificada"
}

node (Join-Path $PSScriptRoot "verify-integrate-version.js") "--previous-patch=$patchBefore"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Verificacao de versao apos bump falhou — integrate abortado"
}

$versionJson = Get-Content -Raw version.json | ConvertFrom-Json
$appVersion = "V$($versionJson.major).$($versionJson.minor).$($versionJson.patch)"
git add version.json package.json src/generated/version.ts frontend/src/generated/version.js src/frontend/login_preview.html
git commit -m "chore(release): $appVersion - integracao main"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha ao commitar bump de versao"
}

Write-Host "=== 7/8 verificar superficies de versao (login + sidebar) ===" -ForegroundColor Cyan
npm run verify:version-ui
if ($LASTEXITCODE -ne 0) {
  Write-Error "verify:version-ui falhou apos bump — corrija antes do push"
}
Write-Host "Versao publicada: $appVersion (patch $($patchBefore) -> $($versionJson.patch))" -ForegroundColor Green

Write-Host "=== 8/8 push $integration e realinhar $machine ===" -ForegroundColor Cyan
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
