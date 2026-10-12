# k3dlamp

A Headlamp Desktop build that creates and operates k3d clusters. It is upstream Headlamp, built from a pinned commit with this repository's product manifest and the [k3d plugin](https://github.com/bitswalk/k3dlamp-k3d-plugin).

Open **k3d** in the sidebar, give it the path of a k3d config file, and click **Create**. The cluster appears in the cluster list as `k3d-<name>`, ready to browse like any other cluster.

## Install

Linux x86_64 only. Installs for the current user, under `~/.local`, without root:

```bash
curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash
```

The installer verifies the download against the release's `SHA256SUMS`, then adds `~/.local/bin/k3dlamp` and a desktop entry. Running it again upgrades. To pin a version, set `K3DLAMP_VERSION=0.1.0` on the `bash` side of the pipe. To install from a mirror, set `K3DLAMP_BASE_URL`.

To create clusters, k3dlamp needs Docker and [k3d](https://k3d.io) on `PATH`. It doesn't install either.

On distributions that restrict unprivileged user namespaces, including Ubuntu 24.04 and later, Chromium's sandbox needs its setuid helper. The installer never runs anything as root. Instead it prints the two `sudo` commands to run once per installed version.

To uninstall, which leaves your settings in `~/.config/k3dlamp`:

```bash
curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash -s -- --uninstall
```

## How it differs from Headlamp

Everything comes from [`app-build-manifest.json`](app-build-manifest.json), which Headlamp's build selects with `HEADLAMP_BUILD_MANIFEST`:

| Setting | Effect |
| --- | --- |
| `product` | Runs as `k3dlamp`, with settings in `~/.config/k3dlamp` and the `k3dlamp://` URL scheme, so it can sit next to a Headlamp install |
| `checkForUpdates: false` | Never points users at upstream Headlamp releases |
| `plugins` | Ships the k3d plugin archive in `plugins/`, pinned by SHA-256, and none of Headlamp's default plugins |
| `runCommands` | Lets that plugin run three k3d commands, listed below |

The manifest replaces Headlamp's default manifest completely, so it is the whole command policy:

| Invocation | Match |
| --- | --- |
| `k3d cluster list -o json` | Exact |
| `k3d cluster create --config <path>` | Prefix |
| `k3d cluster delete <name>` | Prefix |

The shipped policy pre-approves the three commands, so the packaged app never shows Headlamp's consent prompt. The development policy keeps the prompt.

The grants need Headlamp's `runCommands`, which is on `main` but in no release yet; v0.45.0 is the latest. `build/headlamp.Dockerfile` pins commit `032c275fcd3c0301bf03f46c097f012237780d0c`.

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

1. The package holds this manifest and the plugin, byte for byte.
2. The app runs as `k3dlamp`, with its settings in `~/.config/k3dlamp`.
3. The plugin reports k3d missing.
4. After k3d is copied onto `PATH`, **Retry** finds it with no consent prompt.
5. **Create** brings up `dev` from `examples/dev-cluster.yaml`, and `k3d-dev` appears in the app.
6. The app lists the new cluster's node and pods.
7. **Delete** removes the cluster and its kubeconfig context.
8. Renderer code without the plugin's capability cannot run k3d.

The test container runs privileged because it starts its own Docker daemon for k3d, so test clusters never touch the host's Docker. Screenshots, logs and an HTML report land in `out/e2e/`.

## Update the plugin

Pin a [plugin release](https://github.com/bitswalk/k3dlamp-k3d-plugin/releases) by its tag. The script checks the archive against the release's `SHA256SUMS`, replaces the copy in `plugins/`, and updates the manifest:

```bash
./scripts/update-plugin.sh v0.1.0
```

Commit the archive and the manifest together.

## Release

1. Set `product.version` in `app-build-manifest.json` and commit.
2. Push a matching tag, for example `v0.2.0`.

The release workflow checks the tag against `product.version`, runs the same build and tests as CI, and publishes the tarball, `SHA256SUMS`, and an `install.sh` stamped with that version. `releases/latest/download/install.sh` then installs the new release.
