#!/usr/bin/env bash
# Builds Headlamp Desktop for Linux x64 in a container, from the pinned Headlamp
# release, with this product's manifest. Writes
# out/k3dlamp-<version>-linux-x64.tar.gz and its SHA256SUMS.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
rm -f out/k3dlamp-*-linux-x64.tar.gz out/SHA256SUMS
docker build -f build/headlamp.Dockerfile --output type=local,dest=out "$@" .
(cd out && sha256sum -- k3dlamp-*-linux-x64.tar.gz >SHA256SUMS && cat SHA256SUMS)
