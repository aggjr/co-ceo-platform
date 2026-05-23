# Resolve branch da sessao (suporta 2+ agentes no mesmo clone).
# Precedencia: $env:COCEO_MACHINE_BRANCH > perfil COCEO_AGENT_PROFILE > git config > branch atual conhecida

$script:CoCeoBranchAliases = @{
  "atigravity-gamer" = "antigravity-gamer"
  "atigravity-guto"  = "antigravity-guto"
}

$script:CoCeoKnownWorkBranches = @(
  "note-gamer", "note-guto", "antigravity-gamer", "antigravity-guto",
  "atigravity-gamer", "atigravity-guto"
)

function Normalize-CoCeoBranchName([string]$name) {
  if (-not $name) { return $name }
  $key = $name.Trim() -replace "^origin/", ""
  if ($script:CoCeoBranchAliases.ContainsKey($key)) {
    return $script:CoCeoBranchAliases[$key]
  }
  return $key
}

function Read-CoCeoEnvFile([string]$path) {
  $result = @{}
  if (-not (Test-Path $path)) { return $result }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    if ($t -match "^([^=]+)=(.+)$") {
      $result[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $result
}

function Get-CoCeoProfileEnvPaths {
  $paths = @()
  $profile = $env:COCEO_AGENT_PROFILE
  if ($profile) {
    $paths += Join-Path $PSScriptRoot "branch-peer.$profile.local.env"
  }
  $paths += @(
    (Join-Path $PSScriptRoot "branch-workspace.local.env"),
    (Join-Path $PSScriptRoot "branch-peer.local.env")
  )
  return $paths
}

function Read-CoCeoMergedEnv {
  $merged = @{}
  foreach ($path in (Get-CoCeoProfileEnvPaths)) {
    $chunk = Read-CoCeoEnvFile $path
    foreach ($k in $chunk.Keys) { $merged[$k] = $chunk[$k] }
  }
  return $merged
}

function Get-CoCeoMachineBranch {
  if ($env:COCEO_MACHINE_BRANCH) {
    return (Normalize-CoCeoBranchName $env:COCEO_MACHINE_BRANCH)
  }

  $envVars = Read-CoCeoMergedEnv
  if ($envVars.MACHINE_BRANCH) {
    return (Normalize-CoCeoBranchName $envVars.MACHINE_BRANCH)
  }

  try {
    $fromGit = git config --get coceo.machineBranch 2>$null
    if ($fromGit) { return (Normalize-CoCeoBranchName $fromGit) }
  } catch { }

  $current = git branch --show-current 2>$null
  if ($current) {
    $norm = Normalize-CoCeoBranchName $current
    $known = $script:CoCeoKnownWorkBranches | ForEach-Object { Normalize-CoCeoBranchName $_ }
    if ($known -contains $norm) { return $norm }
  }

  return $null
}

function Get-CoCeoIntegrationBranch {
  if ($env:COCEO_INTEGRATION_BRANCH) { return $env:COCEO_INTEGRATION_BRANCH.Trim() }
  $envVars = Read-CoCeoMergedEnv
  if ($envVars.INTEGRATION_BRANCH) { return $envVars.INTEGRATION_BRANCH.Trim() }
  $fromGit = git config --get coceo.integrationBranch 2>$null
  if ($fromGit) { return $fromGit.Trim() }
  return "main"
}

function Assert-CoCeoMachineBranch {
  $machine = Get-CoCeoMachineBranch
  if (-not $machine) {
    Write-Error @"
Branch do agente nao definida.
  Sessao antigravity-gamer:  . .\scripts\set-agent-profile.ps1 antigravity-gamer
  Sessao antigravity-guto:   . .\scripts\set-agent-profile.ps1 antigravity-guto
Ou: `$env:COCEO_MACHINE_BRANCH = 'antigravity-gamer'
"@
  }
  return $machine
}
