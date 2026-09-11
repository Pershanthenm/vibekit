# Fresh Windows machine: installs Node.js LTS if needed, installs vibecheck, then runs the guided setup.
# --minimal installs only what's needed to continue from Claude Code (/vibe-check-cli:setup).
# Safe to run from Claude Code: it answers no prompts itself, checks exit codes instead of relying on
# error streams, and doesn't depend on a PATH refresh to find what it just installed.
$ErrorActionPreference = 'Continue'
$dir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cli = [IO.Path]::Combine($dir, 'bin', 'vibecheck')
$onWindows = $env:OS -eq 'Windows_NT'

function Update-SessionPath {
  if (-not $onWindows) { return }
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $major = & node -p "process.versions.node.split('.')[0]" 2>$null
  return ($LASTEXITCODE -eq 0) -and ([int]$major -ge 20)
}

if (-not (Test-Node)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js 20+ is required and winget is not available. Install Node.js LTS from nodejs.org, then run this again.'
    exit 1
  }
  Write-Host 'Installing Node.js LTS (Windows may ask for permission)...'
  & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  Update-SessionPath
}

if (-not (Test-Node)) {
  Write-Host 'Node.js 20+ is still not available in this window. Close it, open a new one (or restart Claude Code), and run this again.'
  exit 1
}

Write-Host "Installing the vibecheck command from $dir ..."
& npm install -g "$dir" 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Host 'npm install failed; see the messages above.'
  exit 1
}
Update-SessionPath

$rest = @($args)
if ($rest.Count -gt 0 -and $rest[0] -eq '--minimal') {
  $rest = @($rest | Select-Object -Skip 1)
  & node $cli setup --only claude,team-marketplaces,vibecheck-plugin,vibecheck-cli,cursor-agents @rest
  Write-Host ''
  Write-Host 'Next: load the plugin into Claude Code, then run /vibe-check-cli:setup'
  Write-Host '  In a Claude Code session: type /reload-plugins (no restart needed).'
  Write-Host '  If Node.js was installed just now, fully restart Claude Code instead, so it can find Node.'
  exit 0
}
& node $cli setup @rest
exit $LASTEXITCODE
