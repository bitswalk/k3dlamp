#!/usr/bin/env bash
# Rebrands a Headlamp checkout as k3dlamp. It copies branding/overlay/ over
# Headlamp's logos and icons, then replaces the UI strings, theme colours and
# links that name Headlamp. Every change must find its target, so a Headlamp
# bump that moves one fails the build instead of shipping half-branded.
#
#   branding/apply.sh <headlamp checkout>
#
# Needs perl and node, both in the node:22 build image.
set -euo pipefail

branding="$(cd "$(dirname "$0")" && pwd)"
headlamp="$(cd "${1:?usage: $0 <headlamp checkout>}" && pwd)"

RED='#DB162F'
# bitswalk red is too dark for text on a dark sidebar; this tint keeps 4.5:1.
RED_ON_DARK='#FF6B7D'

# replace FILE OLD NEW: every literal occurrence, and at least one.
replace() {
  local file="$headlamp/$1"
  if ! grep -qF -- "$2" "$file"; then
    echo "branding: $1 no longer contains: $2" >&2
    exit 1
  fi
  OLD="$2" NEW="$3" perl -0pi -e 's/\Q$ENV{OLD}\E/$ENV{NEW}/g' "$file"
}

# Logos and icons. Only replace files Headlamp still has.
(cd "$branding/overlay" && find . -type f | sort) | while read -r file; do
  if [ ! -f "$headlamp/$file" ]; then
    echo "branding: Headlamp has no ${file#./} to replace" >&2
    exit 1
  fi
  cp "$branding/overlay/$file" "$headlamp/$file"
done

# Themes: bitswalk red instead of Headlamp yellow for the selected sidebar item.
themes=frontend/src/components/App/defaultAppThemes.ts
replace $themes "name: 'Headlamp Classic'" "name: 'k3dlamp Classic'"
replace $themes "selectedBackground: '#ebe811'" "selectedBackground: '$RED'"
replace $themes "selectedColor: '#ebe811'" "selectedColor: '$RED_ON_DARK'"
replace $themes "selectedBackground: '#f2e600'" "selectedBackground: '$RED'"
replace $themes "selectedColor: '#f2e600'" "selectedColor: '$RED_ON_DARK'"

# Help menu and crash reports point at k3dlamp, which triages upstream bugs.
replace app/electron/main.ts "url: 'https://headlamp.dev/docs/latest/'" \
  "url: 'https://github.com/bitswalk/k3dlamp#readme'"
replace app/electron/main.ts "url: 'https://github.com/kubernetes-sigs/headlamp/issues'" \
  "url: 'https://github.com/bitswalk/k3dlamp/issues'"
replace frontend/src/components/common/ErrorPage/ErrorPage.tsx \
  "const GITHUB_REPO_URL = 'https://github.com/kubernetes-sigs/headlamp';" \
  "const GITHUB_REPO_URL = 'https://github.com/bitswalk/k3dlamp';"

# The update check reads k3dlamp's releases, and its notice's buttons are
# bitswalk red on the notice's fixed dark background.
replace frontend/src/components/common/ReleaseNotes/ReleaseNotes.tsx \
  'https://api.github.com/repos/kinvolk/headlamp/releases' \
  'https://api.github.com/repos/bitswalk/k3dlamp/releases'
replace frontend/src/components/common/ReleaseNotes/UpdatePopup.tsx \
  "color: 'rgb(255, 242, 0)'" "color: '$RED_ON_DARK'"

# Page and web-app metadata.
replace frontend/index.html 'content="Headlamp: Kubernetes Web UI"' \
  'content="k3dlamp: create and operate k3d clusters"'
replace frontend/index.html 'color="#5bbad5"' "color=\"$RED\""
replace frontend/public/manifest.json '"short_name": "Headlamp"' '"short_name": "k3dlamp"'
replace frontend/public/manifest.json '"name": "Headlamp Kubernetes Dashboard"' '"name": "k3dlamp"'

# The three UI strings that name Headlamp, in every language. A translation
# that transliterates the name instead (bn, ta, ur) is blanked, so the app
# falls back to English (i18n config sets returnEmptyString: false).
node - "$headlamp/frontend/src/i18n/locales" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const keys = [
  'This plugin is not compatible with this version of Headlamp',
  'Headlamp Cluster Authentication',
  'Or try running Headlamp with a different kube config.',
];
const root = process.argv[2];
for (const locale of fs.readdirSync(root)) {
  const file = path.join(root, locale, 'translation.json');
  const strings = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of keys) {
    if (!(key in strings)) {
      throw new Error(`branding: ${locale} has no translation key "${key}"`);
    }
    const value = locale === 'en' ? strings[key] || key : strings[key];
    // Matched case-insensitively: fr spells it "HeadLamp".
    strings[key] = /headlamp/i.test(value) ? value.replace(/headlamp/gi, 'k3dlamp') : '';
  }
  fs.writeFileSync(file, JSON.stringify(strings, null, 2) + '\n');
}
EOF

echo "branding: applied k3dlamp branding to $headlamp"
