#!/usr/bin/env bash
# Applies k3dlamp's source changes to a Headlamp checkout: every *.patch here,
# in name order, then translations.json, which adds the strings the patches
# introduce to each of Headlamp's languages. A patch that no longer applies,
# or a language translations.json doesn't cover, fails the build.
#
#   patches/apply.sh <headlamp checkout>
#
# Needs git and node, both in the node:22 build image.
set -euo pipefail

patches="$(cd "$(dirname "$0")" && pwd)"
headlamp="$(cd "${1:?usage: $0 <headlamp checkout>}" && pwd)"

git -C "$headlamp" apply --verbose "$patches"/*.patch

node - "$headlamp/frontend/src/i18n/locales" "$patches/translations.json" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const [root, file] = process.argv.slice(2);
const { $comment, ...translations } = JSON.parse(fs.readFileSync(file, 'utf8'));
const locales = fs.readdirSync(root).sort();
const ours = Object.keys(translations).sort();
if (JSON.stringify(locales) !== JSON.stringify(ours)) {
  throw new Error(`patches: Headlamp's languages are ${locales}, translations.json has ${ours}`);
}
const keys = Object.keys(translations.en).sort();
for (const locale of locales) {
  if (JSON.stringify(Object.keys(translations[locale]).sort()) !== JSON.stringify(keys)) {
    throw new Error(`patches: translations.json's ${locale} strings differ from en's`);
  }
  const target = path.join(root, locale, 'translation.json');
  const strings = JSON.parse(fs.readFileSync(target, 'utf8'));
  Object.assign(strings, translations[locale]);
  fs.writeFileSync(target, JSON.stringify(strings, null, 2) + '\n');
}
console.log(`patches: added ${keys.length} strings to ${locales.length} languages`);
EOF
