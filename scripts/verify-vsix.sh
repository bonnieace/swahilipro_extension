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
# The Marketplace rejects icons that are not real images, whatever the extension says.
while IFS= read -r png; do
  if [[ "$(head -c 8 "$png" | od -An -tx1 | tr -d ' \n')" != "89504e470d0a1a0a" ]]; then
    echo "::error::${png#"$work"/} is not a valid PNG file" >&2
    exit 1
  fi
done < <(find "$work" -type f -iname '*.png')
echo "VSIX is clean."
