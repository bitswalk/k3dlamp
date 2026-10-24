#!/usr/bin/env bash
# Installs out/k3dlamp-*-linux-x64.tar.gz with install.sh and runs the
# end-to-end specs against the installed app.
#
# The container is privileged because it runs its own Docker daemon for k3d,
# so test clusters never touch the host's Docker. Results land in out/e2e/.
#
# K3D_PLUGIN_MAIN_JS=/path/to/dist/main.js runs the specs with that k3d plugin
# build in place of the one Artifact Hub serves, to test both releases together
# before either is published.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
ls out/k3dlamp-*-linux-x64.tar.gz out/SHA256SUMS >/dev/null

docker build -q -f test/e2e/Dockerfile -t headlamp-k3d-e2e . >/dev/null
plugin_build=()
if [ -n "${K3D_PLUGIN_MAIN_JS:-}" ]; then
  plugin_build=(-v "$(realpath "$K3D_PLUGIN_MAIN_JS"):/plugin/main.js:ro" -e K3D_PLUGIN_MAIN_JS=/plugin/main.js)
fi

rm -rf out/e2e
mkdir -p out/e2e
docker run --rm --privileged \
  --mount type=volume,dst=/var/lib/docker \
  -v "$root/out:/artifacts:ro" \
  -v "$root/out/e2e:/results" \
  "${plugin_build[@]}" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  headlamp-k3d-e2e "$@"
