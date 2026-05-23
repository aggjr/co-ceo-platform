# Define o perfil Git desta sessao de terminal/agente (mesmo clone, outro agente = outro perfil).
# Uso:
#   . .\scripts\set-agent-profile.ps1 antigravity-gamer
#   . .\scripts\set-agent-profile.ps1 antigravity-guto

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("antigravity-gamer", "antigravity-guto", "note-gamer", "note-guto")]
  [string]$Profile
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "coceo-git-profile.ps1")

$env:COCEO_AGENT_PROFILE = $Profile
$env:COCEO_MACHINE_BRANCH = (Normalize-CoCeoBranchName $Profile)

Write-Host "Perfil: $Profile" -ForegroundColor Cyan
Write-Host "  COCEO_AGENT_PROFILE  = $env:COCEO_AGENT_PROFILE"
Write-Host "  COCEO_MACHINE_BRANCH = $env:COCEO_MACHINE_BRANCH"
Write-Host ""
Write-Host "Antes de commitar nesta sessao:" -ForegroundColor DarkGray
Write-Host "  git fetch origin"
Write-Host "  .\scripts\git-sync-before-commit.ps1"
Write-Host "  npm run check:branch-overlap"
