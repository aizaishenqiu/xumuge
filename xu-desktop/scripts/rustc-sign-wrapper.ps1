# Cargo RUSTC_WRAPPER (PowerShell). First arg = real rustc.
# Signs freshly linked build-script exes so 360 Safe allows cargo to run them.
$ErrorActionPreference = "Stop"
if ($args.Count -lt 1) { exit 1 }

$rustc = $args[0]
$rest = @()
if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }

$out = $null
for ($i = 0; $i -lt $rest.Count; $i++) {
  if ($rest[$i] -eq "-o" -and ($i + 1) -lt $rest.Count) {
    $out = $rest[$i + 1]
    break
  }
}

& $rustc @rest
$code = $LASTEXITCODE
if ($code -ne 0) { exit $code }

if (-not $out) { exit 0 }
$candidate = $out
if (-not (Test-Path -LiteralPath $candidate) -and (Test-Path -LiteralPath ($out + ".exe"))) {
  $candidate = $out + ".exe"
}
if (-not (Test-Path -LiteralPath $candidate)) { exit 0 }

$norm = $candidate.Replace("/", "\")
if ($norm -notmatch '\\build\\' -and $norm -notmatch 'build_script' -and $norm -notmatch 'build-script') {
  exit 0
}

$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
$thumb = $env:XU_WIN_CODE_SIGN_THUMBPRINT
if (-not $thumb) { $thumb = "F6AF3AAAB9E186746153075C3A9B33401ABE4E70" }
if (Test-Path -LiteralPath $signtool) {
  & $signtool sign /fd sha256 /sha1 $thumb $candidate 2>$null | Out-Null
}
exit 0
