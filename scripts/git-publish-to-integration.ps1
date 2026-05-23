# Alias: mesmo fluxo que git-publish-to-main.ps1 (nome legado).
& (Join-Path $PSScriptRoot "git-publish-to-main.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
