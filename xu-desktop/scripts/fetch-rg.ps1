# 下载 ripgrep 到 src-tauri/bin/rg.exe（Windows x64），供打包进 Tauri resources。
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$BinDir = Join-Path $Root "src-tauri\bin"
$Out = Join-Path $BinDir "rg.exe"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

if (Test-Path $Out) {
  $ver = & $Out --version 2>&1
  Write-Host "已有 rg: $ver"
  exit 0
}

$Version = "14.1.1"
$Zip = "ripgrep-$Version-x86_64-pc-windows-msvc.zip"
$Url = "https://github.com/BurntSushi/ripgrep/releases/download/$Version/$Zip"
$Tmp = Join-Path $env:TEMP "rg-fetch-$Version"
Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

Write-Host "下载 $Url ..."
Invoke-WebRequest -Uri $Url -OutFile (Join-Path $Tmp $Zip) -UseBasicParsing
Expand-Archive -Path (Join-Path $Tmp $Zip) -DestinationPath $Tmp -Force
$Inner = Get-ChildItem -Path $Tmp -Recurse -Filter "rg.exe" | Select-Object -First 1
if (-not $Inner) { throw "zip 内未找到 rg.exe" }
Copy-Item -Force $Inner.FullName $Out
Write-Host "已写入 $Out"
& $Out --version
