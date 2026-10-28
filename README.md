# k3dlamp

A Headlamp Desktop build that creates and operates k3d and kind clusters. It is upstream Headlamp, built from a pinned release with this repository's product manifest, bitswalk branding and eight patches. The manifest lets the [k3d plugin](https://github.com/bitswalk/k3dlamp-k3d-plugin) and the [kind plugin](https://github.com/bitswalk/k3dlamp-kind-plugin), which users install from Artifact Hub, run k3d and kind.

Open **k3d** in the sidebar and click **Add cluster** for a cluster with one k3s server, or **Custom cluster** to write or upload a k3d config first. The cluster appears in the cluster list as `k3d-<name>`, ready to browse like any other cluster. The kind plugin's **kind** page works the same way, for clusters that appear as `kind-<name>`.

## Install

Linux x86_64 only. Installs for the current user, under `~/.local`, without root:

```bash
curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash
```

The installer verifies the download against the release's `SHA256SUMS`, then adds `~/.local/bin/k3dlamp` and a desktop entry. Running it again upgrades. To pin a version, set `K3DLAMP_VERSION=0.1.0` on the `bash` side of the pipe. To install from a mirror, set `K3DLAMP_BASE_URL`.

To create clusters, k3dlamp needs Docker and [k3d](https://k3d.io) on `PATH`. It doesn't install either.

On distributions that restrict unprivileged user namespaces, including Ubuntu 24.04 and later, Chromium's sandbox needs its setuid helper. The installer never runs anything as root. Instead it prints the two `sudo` commands to run once per installed version.

Then install the k3d plugin, the kind plugin, or both, from inside k3dlamp. kind suits machines whose package manager ships it, as Ubuntu's does. This step needs internet access:

1. Open **Plugin Catalog** in the sidebar.
2. Turn off **Only official** and confirm with **Yes**, then search for `k3dlamp`. bitswalk is a verified publisher on Artifact Hub, but the plugins aren't among Headlamp's official ones.
3. Open **k3d for k3dlamp** or **kind for k3dlamp**, click **Install**, confirm, and click **Reload Now**.

To create clusters, the kind plugin needs Docker and [kind](https://kind.sigs.k8s.io) on `PATH`, as the k3d plugin needs k3d. The first time a plugin lists, creates or deletes clusters, k3dlamp asks you to allow that command. It remembers each answer.

### Logs

**Settings → Logs** shows what k3dlamp and its backend logged since k3dlamp started, such as the error behind an "Internal Server Error" notice. Filter it by severity, search it, or copy or download it for a bug report. k3dlamp keeps the latest lines in memory only, errors and warnings separately so routine lines can't push them out. It leaves out the backend's line for each request it serves, which holds only a duration. All lines, those included, still go to k3dlamp's standard output and error. On desktops that start apps under systemd, such as KDE Plasma and GNOME, `journalctl --user -t k3dlamp` reads them.

### Updates

When k3dlamp starts, it checks this repository's releases. If a newer one is out, a notice links to its release page; run the installer again to upgrade. After an upgrade, k3dlamp shows the new release's notes once. k3dlamp never downloads or installs anything itself.

To stop the check, turn off **Settings → Updates → Check for updates at startup**, or click the bell in the notice. Both change the same setting, which applies from the next start.

To uninstall, which leaves your settings and installed plugins in `~/.config/k3dlamp`:

```bash
curl -fsSL https://github.com/bitswalk/k3dlamp/releases/latest/download/install.sh | bash -s -- --uninstall
```

## How it differs from Headlamp

The build makes three kinds of change. Branding replaces Headlamp's logo, icons, colours and name in the UI; see [Branding](#branding). Patches add the **Settings → Updates** and **Settings → Logs** pages, fix the collapsed sidebar's cluster version and icon alignment, let the plugins hand k3d and kind a cluster config on standard input, keep **Settings → Plugins** from abandoning a plugin delete, lock the kubeconfig the way kind and kubectl expect, and let the App Catalog install charts from OCI registries; see [Patches](#patches). Everything else comes from [`app-build-manifest.json`](app-build-manifest.json), which Headlamp's build selects with `HEADLAMP_BUILD_MANIFEST`:

| Setting | Effect |
| --- | --- |
| `product` | Runs as `k3dlamp`, with settings in `~/.config/k3dlamp` and the `k3dlamp://` URL scheme, so it can sit next to a Headlamp install |
| `checkForUpdates` | Not set, so the update check runs unless `HEADLAMP_CHECK_FOR_UPDATES=false`. Branding points it at k3dlamp's releases |
| `plugins` | The App Catalog and Plugin Catalog, as in Headlamp's default build, but not its Prometheus plugin |
| `proxy-urls` | Lets the Plugin Catalog reach Artifact Hub |
| `runCommands` | Lets the k3d and kind plugins, installed from Artifact Hub, run three commands each, listed below |

The manifest replaces Headlamp's default manifest completely, so it is the whole command policy:

| Invocation | Match |
| --- | --- |
| `k3d cluster list -o json` | Exact |
| `k3d cluster create --config -` | Exact. k3d reads the config on standard input |
| `k3d cluster delete <name>` | Prefix |
| `kind get clusters` | Exact |
| `kind create cluster --config - --wait 5m` | Exact. kind reads the config on standard input |
| `kind delete cluster --name <name>` | Prefix |

The packaged app grants the k3d commands only to the plugin that Headlamp's plugin manager installed from the Artifact Hub package `bitswalk-k3dlamp-k3d-plugin/k3dlamp-k3d-plugin`, and the kind commands only to the one from `bitswalk-k3dlamp-kind-plugin/k3dlamp-kind-plugin`. Headlamp checks that against the installation receipt it wrote, not against the plugin's own files. Headlamp doesn't let a policy for store-installed plugins pre-approve commands, so each command asks for consent once. The development policy grants the same commands to locally built copies; see each plugin's README.

The grants need Headlamp's `runCommands`, which first shipped in v0.46.0. `build/headlamp.Dockerfile` pins that tag and its commit, and fails the build if the tag moves. Creating a cluster also needs `0004-run-command-input.patch`, since stock Headlamp passes a plugin's command no standard input. The k3d plugin 0.3.0 and later, and every kind plugin release, need it, so they need k3dlamp 0.4.0 or later.

The manifest ships two plugins, each a release checked against its SHA-256 and package name:

- **App Catalog 0.9.1** browses Helm charts and installs them into the current cluster, through the Helm support Headlamp's desktop backend turns on. Besides Artifact Hub, it lists the charts of any Helm repository that a cluster advertises with a Service labelled `catalog.headlamp.dev/is-catalog`. With `0007-helm-oci-repositories.patch` it also installs charts that Artifact Hub lists only in an OCI registry, such as the kubevirt-stack charts.
- **Plugin Catalog 0.4.5** installs plugins, the k3d plugin among them, from Artifact Hub. Earlier releases fetched only the first 60 Artifact Hub packages, which hid the k3d plugin.

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

1. The package holds this manifest and ships the App Catalog and Plugin Catalog.
2. The app runs as `k3dlamp`, with its settings in `~/.config/k3dlamp`.
3. The Plugin Catalog installs the k3d plugin from Artifact Hub, after one install confirmation.
4. The plugin reports k3d missing.
5. In light and dark themes, the k3d, home and settings pages show the bitswalk logo, a window title ending in `k3dlamp`, the bitswalk red selection, and no "Headlamp" text.
6. After k3d is copied onto `PATH`, **Retry** finds it.
7. **Add cluster** brings up `local-aio`, a single k3s server, and `k3d-local-aio` appears in the app. **Custom cluster** then opens its editor on `local-aio-2`, takes `examples/single-node.yaml` as an upload, reports k3d's refusal of a name already in use, and keeps the draft for **Edit config**.
8. The app lists the new cluster's node and pods. With the sidebar collapsed, the cluster's k3s version shows as major.minor and stays inside it, and each icon sits at the centre of its button and of the sidebar. The App Catalog finds cert-manager's chart.
9. The cluster's row shows it Active, with its k3s version, and Stopped once `k3d cluster stop` stops it. After `k3d cluster start`, **Actions → Delete** removes the cluster and its kubeconfig context.
10. Renderer code without the plugin's capability cannot run k3d.
11. The app asked consent exactly once for each of the three k3d commands.
12. At start, the update check reads k3dlamp's releases, and a newer one brings up the notice, with bitswalk red buttons.
13. **Settings → Updates** shows the setting the notice's bell turned off, and its switch turns the check back on and off. In French, the page and its sidebar entry are translated.
14. After an upgrade, the app shows the new release's notes once, without the install steps.
15. The Plugin Catalog installs the kind plugin from Artifact Hub. Removing a cluster from the home page leaves no `~/.kube/config.lock` behind. With kind on `PATH`, **Add cluster** brings up `local-aio`, one kind node, and the app lists the node of `kind-local-aio`. Its row shows the cluster as Active, with its Kubernetes version, and **Actions → Delete** removes the cluster and its context. The app asked consent once for each of the three kind commands. Deleting the plugin in **Settings → Plugins** never offers **Save & Apply**, and once the page reloads itself the plugin is gone from the page and from disk.
16. **Settings → Logs** shows the backend's and the main process's startup lines, picks up a line the main process logs while the page is open, and leaves out the per-request timing lines. Its severity filter hides the INFO lines.

The specs answer the native install and consent dialogs as a user accepting them would, and record each one. Steps 3 and 15 install from the live Artifact Hub, so the tests need internet access. Steps 12 to 14 answer the update check with stub releases instead of GitHub's.

A k3dlamp release and a plugin release that depend on each other can't both be on Artifact Hub before the tests run. The specs also follow the plugins' pages, so a plugin release that changes its page must be tested before it is published. In either case, pass the plugin's build:

```bash
K3D_PLUGIN_MAIN_JS=/path/to/k3dlamp-k3d-plugin/dist/main.js ./scripts/test-headlamp.sh
```

```bash
KIND_PLUGIN_MAIN_JS=/path/to/k3dlamp-kind-plugin/dist/main.js ./scripts/test-headlamp.sh
```

Steps 3 and 15 still install the plugin from Artifact Hub, then replace its `main.js` with that build and record the build's digest in Headlamp's installation receipt. The plugin keeps its store identity, so it gets the same grants. Run the plain tests again once the plugin release is on Artifact Hub.

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
| Update check | Reads this repository's releases instead of Headlamp's |
| Update notice buttons | `#FF6B7D` instead of Headlamp yellow |

The version dialog still names Headlamp beside k3dlamp's own version, as the platform k3dlamp is built on.

Each change must find what it replaces, and each overlay file must replace an existing Headlamp file. A Headlamp bump that moves any of them fails the build rather than shipping half-branded.

The overlay is generated by [`branding/generate.py`](branding/generate.py). It traces the bitswalk mark from the org's avatar in `branding/source/`, checks the trace pixel for pixel, and sets the wordmark in Overpass Regular, the font Headlamp's UI uses. To regenerate the overlay, pass it the font from a Headlamp checkout:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/branding:/branding" \
  -v /path/to/headlamp/frontend/src/assets/fonts/overpass:/font:ro python:3.13-slim \
  sh -c 'pip install -q --user pillow==11.3.0 fonttools==4.60.1 brotli==1.1.0 && python /branding/generate.py /font/latin.woff2'
```

## Patches

[`patches/`](patches) holds the source changes that string replacements can't make. Before branding, [`patches/apply.sh`](patches/apply.sh) applies them with `git apply`, in name order. It then merges [`patches/translations.json`](patches/translations.json), the patches' UI strings in every language Headlamp ships, into Headlamp's locale files. A Headlamp bump that breaks a patch, or adds or drops a language, fails the build.

| Patch | Change |
| --- | --- |
| `0001-settings-updates-page.patch` | Adds **Settings → Updates**, desktop app only, with a switch for the startup update check. It shares the setting the update notice's bell turns off |
| `0002-sidebar-short-version.patch` | Shows the cluster version as major.minor, such as `v1.35`, while the sidebar is collapsed. A full k3s version like `v1.35.5+k3s1` overflowed the collapsed sidebar. The tooltip and version dialog keep the full version |
| `0003-sidebar-center-collapsed-icons.patch` | Centres each icon in its button while the sidebar is collapsed. Headlamp left it against the button's left padding, off the centre of the hover and selection highlight and of the sidebar |
| `0004-run-command-input.patch` | Lets a plugin send standard input to a command the manifest grants it: `input`, a string of at most 1 MiB, is the only option such a command takes. The k3d plugin sends its cluster config this way, to `k3d cluster create --config -`. Consent and grants still cover only the command and its arguments, so a granted `create` takes any config the plugin sends |
| `0005-plugin-delete-before-save.patch` | Keeps **Settings → Plugins** from offering **Save & Apply** for a plugin delete, and disables it while any delete runs. The delete waits out a 5-second cancellation window before it reaches the backend, and saving reloads the page, so saving in that window abandoned the delete. A successful delete reloads the page itself |
| `0006-kubeconfig-lock-file.patch` | Locks the kubeconfig the way client-go, kubectl and kind do: by creating `~/.kube/config.lock` exclusively, waiting while another program holds it, and removing it when done. Headlamp held an `flock` on that file instead and left it behind, so after Headlamp's first kubeconfig edit kind created clusters but failed to add them to the kubeconfig |
| `0007-helm-oci-repositories.patch` | Lets the App Catalog install a chart whose Artifact Hub repository URL is `oci://`, such as `oci://ghcr.io/naval-group/kubevirt-stack-charts/kubevirt`. Adding such a repository failed with a 500, because Headlamp downloaded every repository's index and an OCI registry has none. Headlamp now records an `oci://` repository without an index. Install and upgrade pull `<repo>/<chart>` from the registry, signing in with the credentials `helm registry login` saves. The upgrade dialog lists versions only from indexes, so it offers none for these charts |
| `0008-settings-logs-page.patch` | Adds **Settings → Logs**, desktop app only. The main process keeps the backend's output and its own console output in memory, 5,000 routine lines and 1,000 errors and warnings, and drops the backend's per-request timing lines. The page reads new lines every two seconds into the log viewer that pod logs use, with its severity filter, find, copy and download. Downloads, pod logs' included, leave out colour codes. Before this page, the backend's errors reached only standard error, and the UI showed a bare "Internal Server Error" |

To change a patch, apply them all to a checkout of the pinned tag, edit, and write each one back with `git diff`. Keep the description lines at the top of the file. A new UI string goes into `translations.json` for every language. Languages Headlamp itself barely translates, currently Hebrew, Hindi and both Portuguese variants, get empty strings, so they fall back to English like the rest of their UI.

## The k3d plugin

k3dlamp doesn't carry the plugin. Each plugin release publishes itself on Artifact Hub, and users install or update it from the Plugin Catalog. Nothing here needs to change for a new plugin version, unless the plugin needs different commands.

The `runCommands` policy pins the plugin's Artifact Hub package and repository IDs, as well as their names. That keeps the grant with this package even if a repository of the same name is deleted and recreated by someone else.

## The kind plugin

The [kind plugin](https://github.com/bitswalk/k3dlamp-kind-plugin) creates and deletes [kind](https://kind.sigs.k8s.io) clusters with the same page, for machines where kind is the easier install. The manifest's `kind` command set holds its three commands, and its policy pins the kind plugin's Artifact Hub package and repository IDs, as the k3d plugin's does.

## Release

1. Set `product.version` in `app-build-manifest.json` and commit.
2. Push a matching annotated tag whose message says what changed, for example `git tag -a v0.3.1 -m "Adds Settings → Updates."`.

The release workflow checks the tag is annotated and matches `product.version`, then runs the same build and tests as CI. It publishes the tarball, `SHA256SUMS`, and an `install.sh` stamped with that version. `releases/latest/download/install.sh` then installs the new release.

The release is titled with the bare tag, because the update check reads the title as a version. Its notes open with the tag message and the component versions, which is what k3dlamp shows after an upgrade. The install steps follow Headlamp's `<!-- end-release-notes -->` marker, so they appear only on the release page.
