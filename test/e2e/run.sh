#!/bin/sh
# Starts a Docker daemon private to this container for k3d, installs the
# k3dlamp build from /artifacts with install.sh, and runs the specs under a
# virtual display.
set -eu

results="${RESULTS_DIR:-/results}"
mkdir -p "$results/screens"

dind dockerd >"$results/dockerd.log" 2>&1 &
tries=0
until docker info >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "dockerd did not start; see $results/dockerd.log" >&2
    exit 1
  fi
  sleep 1
done

archive="$(basename /artifacts/k3dlamp-*-linux-x64.tar.gz)"
version="${archive#k3dlamp-}"
version="${version%-linux-x64.tar.gz}"
K3DLAMP_VERSION="$version" K3DLAMP_BASE_URL=file:///artifacts bash /e2e/install.sh
export HEADLAMP_BIN="$HOME/.local/bin/k3dlamp"

status=0
xvfb-run -a -s "-screen 0 1440x900x24" npx playwright test "$@" || status=$?

# Results are written as root; hand them back to the caller.
if [ -n "${HOST_UID:-}" ]; then
  chown -R "$HOST_UID:${HOST_GID:-$HOST_UID}" "$results"
fi
exit "$status"
