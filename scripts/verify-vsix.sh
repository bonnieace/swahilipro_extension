#!/usr/bin/env bash
# Fail if the packaged VSIX contains executables or process/network code.
set -euo pipefail
vsix="${1:?usage: verify-vsix.sh <file.vsix>}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q "$vsix" -d "$work"
echo "VSIX contents:"
(cd "$work" && find . -type f | sort)
if find "$work" -type f | grep -Ei '\.(exe|dll|so|dylib|bin|sh|ps1|bat|cmd|node)$|/runtime/'; then
  echo "::error::Executable content found in VSIX" >&2
  exit 1
fi
if find "$work" -type f -perm -u+x | grep -q .; then
  echo "::error::Files with executable permission found in VSIX" >&2
  exit 1
fi
if grep -rEn "child_process|powershell|execFile|execSync|spawn\(|require\([\"'](https?|net|dgram)[\"']\)|fetch\(" "$work/extension" --include=*.js; then
  echo "::error::Process-spawning or network code found in VSIX" >&2
  exit 1
fi
echo "VSIX is clean."
