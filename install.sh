#!/usr/bin/env bash
# Installs k3dlamp, a Headlamp Desktop build that drives k3d, for the current user.
#
#   curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash
#
# Uninstall (keeps your settings in ~/.config/k3dlamp):
#
#   curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash -s -- --uninstall
#
# Environment:
#   K3DLAMP_VERSION   version to install; defaults to the release this script came from
#   K3DLAMP_PREFIX    install prefix; defaults to ~/.local
#   K3DLAMP_BASE_URL  where to download from; defaults to the GitHub release,
#                     set it to use a mirror
#
# The script never runs anything as root. When the system needs a root step
# for Chromium's sandbox, it prints the commands instead.

set -euo pipefail

# The release workflow replaces this with the release's version.
RELEASE_VERSION="@VERSION@"
TMP_DIR=""
trap 'rm -rf "$TMP_DIR"' EXIT

say() { printf '%s\n' "$*"; }
note() { printf '\n%s\n' "$*"; }
fail() {
  printf 'k3dlamp install: %s\n' "$*" >&2
  exit 1
}

userns_restricted() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] ||
    [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] ||
    [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = 0 ]
}

setuid_root() {
  [ -u "$1" ] && [ "$(stat -c %u "$1")" = 0 ]
}

main() {
  local prefix="${K3DLAMP_PREFIX:-$HOME/.local}"
  local lib_dir="$prefix/lib/k3dlamp"
  local bin_dir="$prefix/bin"
  local desktop_file="${XDG_DATA_HOME:-$HOME/.local/share}/applications/k3dlamp.desktop"

  case "${1:-}" in
    --uninstall)
      rm -rf "$lib_dir"
      rm -f "$bin_dir/k3dlamp" "$desktop_file"
      say "Removed k3dlamp. Your settings in ~/.config/k3dlamp are untouched."
      return
      ;;
    "") ;;
    *) fail "unknown option: $1 (the only option is --uninstall)" ;;
  esac

  local version="${K3DLAMP_VERSION:-$RELEASE_VERSION}"
  version="${version#v}"
  if [ "$version" = "@VERSION@" ]; then
    fail "this copy of install.sh is not from a release; set K3DLAMP_VERSION"
  fi
  local base_url="${K3DLAMP_BASE_URL:-https://github.com/bitswalk/k3dlamp/releases/download/v$version}"

  [ "$(uname -s)" = Linux ] || fail "k3dlamp is built for Linux only"
  [ "$(uname -m)" = x86_64 ] || fail "k3dlamp is built for x86_64 only, not $(uname -m)"
  local tool
  for tool in curl tar sha256sum; do
    command -v "$tool" >/dev/null || fail "$tool is required"
  done

  local archive="k3dlamp-$version-linux-x64.tar.gz"
  TMP_DIR="$(mktemp -d)"
  local tmp="$TMP_DIR"

  say "Downloading k3dlamp $version..."
  curl -fsSL -o "$tmp/SHA256SUMS" "$base_url/SHA256SUMS" || fail "no k3dlamp $version at $base_url"
  curl -fSL --progress-bar -o "$tmp/$archive" "$base_url/$archive"
  grep -E "^[0-9a-f]{64}  $archive\$" "$tmp/SHA256SUMS" >"$tmp/expected" ||
    fail "SHA256SUMS has no entry for $archive"
  (cd "$tmp" && sha256sum --check --quiet expected) || fail "$archive failed its checksum"

  local dest="$lib_dir/$version"
  mkdir -p "$lib_dir" "$bin_dir" "$(dirname "$desktop_file")"
  rm -rf "$dest" "$lib_dir/.incoming"
  mkdir "$lib_dir/.incoming"
  tar -xzf "$tmp/$archive" -C "$lib_dir/.incoming" --strip-components=1
  [ -x "$lib_dir/.incoming/k3dlamp" ] || fail "$archive has no k3dlamp executable"
  mv "$lib_dir/.incoming" "$dest"

  ln -sfn "$version" "$lib_dir/current"
  ln -sfn "$lib_dir/current/k3dlamp" "$bin_dir/k3dlamp"

  # Headlamp only notices plugins installed from the catalog in a user-plugins
  # folder that existed at launch, so create it now; otherwise the k3d plugin
  # appears only after a restart. Headlamp uses the data folder when it exists.
  local data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/k3dlamp"
  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/k3dlamp"
  if [ -d "$data_dir" ]; then
    mkdir -p "$data_dir/user-plugins"
  else
    mkdir -p "$config_dir/user-plugins"
  fi
  local old
  for old in "$lib_dir"/*; do
    case "$(basename "$old")" in
      "$version" | current) ;;
      *) rm -rf "$old" ;;
    esac
  done

  cat >"$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=k3dlamp
Comment=Create and operate k3d clusters with Headlamp
Exec="$bin_dir/k3dlamp" %U
Icon=$lib_dir/current/resources/frontend/android-chrome-512x512.png
Terminal=false
Categories=Development;System;
MimeType=x-scheme-handler/k3dlamp;
StartupWMClass=k3dlamp
EOF
  command -v update-desktop-database >/dev/null &&
    update-desktop-database -q "$(dirname "$desktop_file")" 2>/dev/null || true

  say "Installed k3dlamp $version in $dest"

  if userns_restricted && ! setuid_root "$dest/chrome-sandbox"; then
    note "This system restricts unprivileged user namespaces, so Chromium's sandbox needs" \
      "its setuid helper. k3dlamp will not start until you run, once per version:"
    printf '  sudo chown root:root %q\n  sudo chmod 4755 %q\n' \
      "$dest/chrome-sandbox" "$dest/chrome-sandbox"
  fi

  local missing=()
  for tool in k3d docker; do
    command -v "$tool" >/dev/null || missing+=("$tool")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    note "k3dlamp creates clusters with k3d and Docker. Not found on PATH: ${missing[*]}"
  fi

  case ":$PATH:" in
    *":$bin_dir:"*) note "Start it with: k3dlamp" ;;
    *) note "Start it with: $bin_dir/k3dlamp  ($bin_dir is not on your PATH)" ;;
  esac
}

main "$@"
