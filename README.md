# k3dlamp

A Headlamp Desktop build that creates and operates k3d clusters. It is upstream Headlamp, built from a pinned commit with this repository's product manifest and bitswalk branding. The manifest lets the [k3d plugin](https://github.com/bitswalk/k3dlamp-k3d-plugin), which users install from Artifact Hub, run k3d.

Open **k3d** in the sidebar, give it the path of a k3d config file, and click **Create**. The cluster appears in the cluster list as `k3d-<name>`, ready to browse like any other cluster.

## Install

Linux x86_64 only. Installs for the current user, under `~/.local`, without root:

```bash
curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash
```

The installer verifies the download against the release's `SHA256SUMS`, then adds `~/.local/bin/k3dlamp` and a desktop entry. Running it again upgrades. To pin a version, set `K3DLAMP_VERSION=0.1.0` on the `bash` side of the pipe. To install from a mirror, set `K3DLAMP_BASE_URL`.

To create clusters, k3dlamp needs Docker and [k3d](https://k3d.io) on `PATH`. It doesn't install either.

On distributions that restrict unprivileged user namespaces, including Ubuntu 24.04 and later, Chromium's sandbox needs its setuid helper. The installer never runs anything as root. Instead it prints the two `sudo` commands to run once per installed version.

Then install the k3d plugin from inside k3dlamp. This step needs internet access:

1. Open **Plugin Catalog** in the sidebar.
2. Turn off **Only official** and confirm with **Yes**, then search for `k3dlamp`. bitswalk is a verified publisher on Artifact Hub, but the plugin isn't one of Headlamp's official ones.
3. Open **k3d for k3dlamp**, click **Install**, confirm, and click **Reload Now**.

The first time the plugin lists, creates or deletes clusters, k3dlamp asks you to allow that command. It remembers each answer.

To uninstall, which leaves your settings and installed plugins in `~/.config/k3dlamp`:

```bash
curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash -s -- --uninstall
```

## How it differs from Headlamp

The build makes two kinds of change. Branding replaces Headlamp's logo, icons, colours and name in the UI; see [Branding](#branding). Everything else comes from [`app-build-manifest.json`](app-build-manifest.json), which Headlamp's build selects with `HEADLAMP_BUILD_MANIFEST`:

| Setting | Effect |
| --- | --- |
| `product` | Runs as `k3dlamp`, with settings in `~/.config/k3dlamp` and the `k3dlamp://` URL scheme, so it can sit next to a Headlamp install |
| `checkForUpdates: false` | Never points users at upstream Headlamp releases |
| `plugins` | Absent, so none of Headlamp's default plugins ship |
| `proxy-urls` | Lets the Plugin Catalog reach Artifact Hub |
| `runCommands` | Lets the k3d plugin, installed from Artifact Hub, run three k3d commands, listed below |

The manifest replaces Headlamp's default manifest completely, so it is the whole command policy:

| Invocation | Match |
| --- | --- |
| `k3d cluster list -o json` | Exact |
| `k3d cluster create --config <path>` | Prefix |
| `k3d cluster delete <name>` | Prefix |

The packaged app grants them only to the plugin that Headlamp's plugin manager installed from the Artifact Hub package `bitswalk/k3dlamp-k3d-plugin`. Headlamp checks that against the installation receipt it wrote, not against the plugin's own files. Headlamp doesn't let a policy for store-installed plugins pre-approve commands, so each of the three asks for consent once. The development policy grants the same commands to a locally built copy; see the plugin's README.

The grants need Headlamp's `runCommands`, which first shipped in v0.46.0. `build/headlamp.Dockerfile` pins that tag and its commit, and fails the build if the tag moves.

The manifest ships one plugin, the Plugin Catalog 0.4.5 release, checked against its SHA-256. Earlier releases fetched only the first 60 Artifact Hub packages, which hid the k3d plugin.

## Build and test

Needs only Docker. Both steps run in containers.

```bash
./scripts/build-headlamp.sh
```

```bash
./scripts/test-headlamp.sh
```

`build-headlamp.sh` fetches Headlamp at the pinned commit and builds it with this manifest. It writes `out/k3dlamp-<version>-linux-x64.tar.gz` and `out/SHA256SUMS`.

`test-headlamp.sh` installs that build with `install.sh` and drives it with Playwright under Xvfb. The specs check, in order, that:

1. The package holds this manifest and ships only the Plugin Catalog.
2. The app runs as `k3dlamp`, with its settings in `~/.config/k3dlamp`.
3. The Plugin Catalog installs the k3d plugin from Artifact Hub, after one install confirmation.
4. The plugin reports k3d missing.
5. In light and dark themes, the k3d, home and settings pages show the bitswalk logo, a window title ending in `k3dlamp`, the bitswalk red selection, and no "Headlamp" text.
6. After k3d is copied onto `PATH`, **Retry** finds it.
7. **Create** brings up `dev` from `examples/dev-cluster.yaml`, and `k3d-dev` appears in the app.
8. The app lists the new cluster's node and pods.
9. **Delete** removes the cluster and its kubeconfig context.
10. Renderer code without the plugin's capability cannot run k3d.
11. The app asked consent exactly once for each of the three k3d commands.

The specs answer the native install and consent dialogs as a user accepting them would, and record each one. Step 3 installs from the live Artifact Hub, so the tests need internet access.

The test container runs privileged because it starts its own Docker daemon for k3d, so test clusters never touch the host's Docker. Screenshots, logs and an HTML report land in `out/e2e/`.

## Branding

[`branding/apply.sh`](branding/apply.sh) runs on the Headlamp checkout before the frontend build. It makes these changes:

| What | Change |
| --- | --- |
| Logo, favicons, app and tray icons | Replaced by the files in `branding/overlay/`, which mirror Headlamp's paths |
| Sidebar selection in the Light, Dark and Classic themes | Bitswalk red `#DB162F` instead of Headlamp yellow, with `#FF6B7D` for accent text on dark sidebars. Every pair is at least 4.5:1 contrast |
| Classic theme name | `k3dlamp Classic` |
| The three UI strings that name Headlamp | Say k3dlamp, in all 26 languages. Translations that transliterate the name fall back to English |
| **Help → Documentation** and **Open an Issue**, crash reports | Point at this repository |
| Page description and web-app manifest | Name k3dlamp |

The version dialog still names Headlamp beside k3dlamp's own version, as the platform k3dlamp is built on.

Each change must find what it replaces, and each overlay file must replace an existing Headlamp file. A Headlamp bump that moves any of them fails the build rather than shipping half-branded.

The overlay is generated by [`branding/generate.py`](branding/generate.py). It traces the bitswalk mark from the org's avatar in `branding/source/`, checks the trace pixel for pixel, and sets the wordmark in Overpass Regular, the font Headlamp's UI uses. To regenerate the overlay, pass it the font from a Headlamp checkout:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/branding:/branding" \
  -v /path/to/headlamp/frontend/src/assets/fonts/overpass:/font:ro python:3.13-slim \
  sh -c 'pip install -q --user pillow==11.3.0 fonttools==4.60.1 brotli==1.1.0 && python /branding/generate.py /font/latin.woff2'
```

## The k3d plugin

k3dlamp doesn't carry the plugin. Each plugin release publishes itself on Artifact Hub, and users install or update it from the Plugin Catalog. Nothing here needs to change for a new plugin version, unless the plugin needs different commands.

The `runCommands` policy pins the plugin's Artifact Hub package and repository IDs, as well as their names. That keeps the grant with this package even if a repository of the same name is deleted and recreated by someone else.

## Release

1. Set `product.version` in `app-build-manifest.json` and commit.
2. Push a matching tag, for example `v0.2.0`.

The release workflow checks the tag against `product.version`, runs the same build and tests as CI, and publishes the tarball, `SHA256SUMS`, and an `install.sh` stamped with that version. `releases/latest/download/install.sh` then installs the new release.
