#Requires -Version 5.1
<#
.SYNOPSIS
  Create or refresh a local Windows Authenticode cert for Tauri builds (Virmoor / xumuge).

.DESCRIPTION
  Self-signed only — trusted for the current Windows user; does NOT clear SmartScreen elsewhere.
  Writes (all gitignored except this script):
    - src-tauri/certificates/xumuge-local.pfx (+ .cer)
    - src-tauri/tauri.windows.conf.json
    - .env.signing.local

  Production: import commercial PFX into CurrentUser\My, update thumbprint in
  .env.signing.local, then: pnpm prepare:signing

  NOTE: Keep this .ps1 ASCII-only so Windows PowerShell 5.1 parses it without UTF-8 BOM.

.EXAMPLE
  pnpm setup:signing
#>

$ErrorActionPreference = "Stop"

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$EnvLocalPath = Join-Path $Root ".env.signing.local"

function Read-DotEnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $idx = $t.IndexOf("=")
    if ($idx -lt 1) { continue }
    $k = $t.Substring(0, $idx).Trim()
    if ($k -ne $Key) { continue }
    return $t.Substring($idx + 1).Trim().Trim('"').Trim("'")
  }
  return $null
}

# Prefer existing .env.signing.local overrides (re-run keeps password/subject).
$Subject = Read-DotEnvValue $EnvLocalPath "XU_WIN_CODE_SIGN_SUBJECT"
if (-not $Subject) { $Subject = "CN=Virmoor Desktop Local" }
if ($env:XU_WIN_CODE_SIGN_SUBJECT) { $Subject = $env:XU_WIN_CODE_SIGN_SUBJECT }

$Publisher = Read-DotEnvValue $EnvLocalPath "XU_WIN_CODE_SIGN_PUBLISHER"
if (-not $Publisher) { $Publisher = "Virmoor (local test)" }
if ($env:XU_WIN_CODE_SIGN_PUBLISHER) { $Publisher = $env:XU_WIN_CODE_SIGN_PUBLISHER }

$Digest = Read-DotEnvValue $EnvLocalPath "XU_WIN_CODE_SIGN_DIGEST"
if (-not $Digest) { $Digest = "sha256" }

$PfxPasswordPlain = Read-DotEnvValue $EnvLocalPath "XU_WIN_CODE_SIGN_PFX_PASSWORD"
if (-not $PfxPasswordPlain) { $PfxPasswordPlain = "xumuge-local-dev-only" }
if ($env:XU_WIN_CODE_SIGN_PFX_PASSWORD) { $PfxPasswordPlain = $env:XU_WIN_CODE_SIGN_PFX_PASSWORD }

$CertDir = Join-Path $Root "src-tauri\certificates"
$PfxPath = Join-Path $CertDir "xumuge-local.pfx"
$CerPath = Join-Path $CertDir "xumuge-local.cer"
$ConfPath = Join-Path $Root "src-tauri\tauri.windows.conf.json"
$FriendlyName = "Virmoor Desktop Local"

function Find-ExistingCert {
  Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $Subject -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
}

function Ensure-PublicTrust {
  param(
    [Parameter(Mandatory = $true)]
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
    [Parameter(Mandatory = $true)]
    [string]$StoreName
  )

  $storePath = "Cert:\CurrentUser\$StoreName"
  $exists = Get-ChildItem $storePath -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Certificate.Thumbprint }

  if ($exists) {
    Write-Host "  already in $StoreName"
    return
  }

  Write-Host "  importing into $StoreName ..."
  Import-Certificate -FilePath $CerPath -CertStoreLocation $storePath | Out-Null
}

Write-Host "==> Virmoor / xumuge - Windows local code signing"
Write-Host "    Subject: $Subject"

$cert = Find-ExistingCert
if ($cert) {
  Write-Host "Found existing cert: $($cert.Thumbprint) (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))"
  $dupes = @(
    Get-ChildItem Cert:\CurrentUser\My |
      Where-Object { $_.Subject -eq $Subject -and $_.Thumbprint -ne $cert.Thumbprint }
  )
  foreach ($dupe in $dupes) {
    Write-Host "Removing duplicate cert: $($dupe.Thumbprint)"
    Remove-Item -Path "Cert:\CurrentUser\My\$($dupe.Thumbprint)" -Force
  }
} else {
  Write-Host "Creating self-signed Code Signing certificate..."
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(5) `
    -FriendlyName $FriendlyName
  Write-Host "Created: $($cert.Thumbprint)"
}

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null
$securePassword = ConvertTo-SecureString -String $PfxPasswordPlain -Force -AsPlainText

Write-Host "Exporting PFX -> $PfxPath"
Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $cert -FilePath $CerPath -Type CERT | Out-Null

# Signing only needs the private key in CurrentUser\My (already there).
# TrustedPublisher helps local "publisher known" checks; Root often pops a
# blocking Security Warning UI — skip Root for unattended setup.
Write-Host "Trusting certificate as TrustedPublisher (CurrentUser)..."
try {
  Ensure-PublicTrust -Certificate $cert -StoreName "TrustedPublisher"
} catch {
  Write-Host "  TrustedPublisher import skipped: $($_.Exception.Message)"
}
Write-Host "  (Optional) To trust the chain locally, manually import the .cer into CurrentUser\Root."

$thumbprint = $cert.Thumbprint.ToUpperInvariant()
$pfxRel = "src-tauri/certificates/xumuge-local.pfx"

$jsonOut = @"
{
  "bundle": {
    "publisher": "$Publisher",
    "windows": {
      "certificateThumbprint": "$thumbprint",
      "digestAlgorithm": "$Digest"
    }
  }
}
"@

$confFull = [System.IO.Path]::GetFullPath($ConfPath)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($confFull, ($jsonOut.TrimEnd() + "`n"), $utf8NoBom)
Write-Host "Wrote $confFull"

$envBody = @"
# Virmoor Windows Authenticode - gitignored (.env.*.local)
# Swap to OV/EV: import PFX to CurrentUser\My, set THUMBPRINT/PASSWORD, then: pnpm prepare:signing
XU_WIN_CODE_SIGN_SUBJECT=$Subject
XU_WIN_CODE_SIGN_PUBLISHER=$Publisher
XU_WIN_CODE_SIGN_THUMBPRINT=$thumbprint
XU_WIN_CODE_SIGN_PFX_PATH=$pfxRel
XU_WIN_CODE_SIGN_PFX_PASSWORD=$PfxPasswordPlain
XU_WIN_CODE_SIGN_DIGEST=$Digest
"@
[System.IO.File]::WriteAllText($EnvLocalPath, ($envBody.TrimEnd() + "`n"), $utf8NoBom)
Write-Host "Wrote $EnvLocalPath"

Write-Host ""
Write-Host "Done. Build with: pnpm build:release"
Write-Host "Notes:"
Write-Host "  - Trusted for this Windows user only; re-run on a new PC"
Write-Host "  - Self-signed will NOT clear SmartScreen on other machines"
Write-Host "  - Later: edit .env.signing.local then pnpm prepare:signing"
