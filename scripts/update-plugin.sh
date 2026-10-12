#!/usr/bin/env bash
# Pins a k3dlamp-k3d-plugin release: downloads its archive, checks it against
# the release's SHA256SUMS, stores it in plugins/, and points
# app-build-manifest.json at it.
#
#   scripts/update-plugin.sh v0.1.0
set -euo pipefail

tag="${1:?usage: $0 <plugin release tag, for example v0.1.0>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
base="https://github.com/bitswalk/k3dlamp-k3d-plugin/releases/download/$tag"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"
read -r digest archive <"$tmp/SHA256SUMS"
if [[ ! "$archive" =~ ^[A-Za-z0-9._-]+\.tar\.gz$ || ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Unexpected SHA256SUMS in $tag" >&2
  exit 1
fi
curl -fsSL -o "$tmp/$archive" "$base/$archive"
(cd "$tmp" && sha256sum --check --quiet SHA256SUMS)

rm -f "$root"/plugins/*.tar.gz
mkdir -p "$root/plugins"
mv "$tmp/$archive" "$root/plugins/"
sed -i -E \
  -e "s#(\"file\": \"\./plugins/)[^\"]+#\1$archive#" \
  -e "s#(\"sha256\": \")[0-9a-f]{64}#\1$digest#" \
  "$root/app-build-manifest.json"

echo "Pinned plugins/$archive ($digest) from k3dlamp-k3d-plugin $tag"
