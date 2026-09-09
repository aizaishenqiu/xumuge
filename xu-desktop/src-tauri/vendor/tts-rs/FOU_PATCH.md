# Vendored tts-rs (MIT) patched for ort 2.0.0-rc.13.
# Upstream: https://github.com/rishiskhare/tts-rs / crates.io tts-rs 2026.2.3
# Do not replace with crates.io until upstream compiles against current ort.
#
# Fou patches:
# - ort 2.0.0-rc.13 API
# - Windows espeak UTF-8 file + `--path` = espeak-ng-data (no `\\?\` parent bug)
# - Mandarin: zh_g2p (misaki legacy IPA) instead of espeak `cmn`
