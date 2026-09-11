# New developer, from scratch (Windows): installs git if needed, gets your team's Vibe-check-cli kit,
# and installs everything it needs. Run it with:
#
#   powershell -ExecutionPolicy Bypass -File onboard.ps1 <team repository URL>
#
# -ExecutionPolicy Bypass lets this one script run without changing your system's policy.
$ErrorActionPreference = 'Continue'
$repoUrl = if ($args.Count -gt 0) { $args[0] } else { $env:VIBECHECK_TEAM_REPO }
$target = if ($env:VIBECHECK_TARGET) { $env:VIBECHECK_TARGET } else { [IO.Path]::Combine($HOME, 'tools', 'vibe-check-cli') }
$onWindows = $env:OS -eq 'Windows_NT'
if (-not $repoUrl) {
  Write-Host 'Usage: powershell -ExecutionPolicy Bypass -File onboard.ps1 <team repository URL>   (ask your team lead for the URL)'
  exit 1
}

function Write-Step($message) { Write-Host ''; Write-Host "== $message" }
function Update-SessionPath {
  if (-not $onWindows) { return }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

Write-Step 'Checking git'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host 'Install Git for Windows from git-scm.com, then run this again.'
    exit 1
  }
  & winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
  Update-SessionPath
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Git was installed but this window cannot see it yet. Close it, open a new one, and run this again.'
  exit 1
}
& git --version

Write-Step "Getting your team's kit into $target"
if (Test-Path ([IO.Path]::Combine($target, '.git'))) {
  & git -C $target pull --ff-only
} else {
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  & git clone $repoUrl $target
}
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Could not get the kit. Check the URL and that you have access to the repository (your lead can add you).'
  exit 1
}

Write-Step 'Installing Node.js (if needed), Claude Code, the plugin, and the Cursor kit'
& ([IO.Path]::Combine($target, 'plugin', 'scripts', 'bootstrap.ps1')) --minimal --yes

Write-Step 'Done'
Write-Host 'Next, in Cursor:'
Write-Host '  1. Open the Claude Code panel (Spark icon) and sign in if asked.'
Write-Host '  2. Type /reload-plugins, then /vibe-check-cli:setup, then /vibe-check-cli:health live'
Write-Host '  If Node.js or Git were installed just now, close Cursor completely and reopen it first.'
