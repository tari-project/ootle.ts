#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Set the workspace version and propagate it to every publishable package so they all
# inherit it. The root package.json is the single source of truth.
#
# Usage: ./scripts/set_package_versions.sh [version]
#   <version>  bump the whole workspace (root + all packages/*) to this version
#   (no arg)   re-sync packages/* to the current root (workspace) version

if [ "$#" -gt 1 ]; then
    echo "Usage: $0 [version]   (defaults to the current root/workspace version)"
    exit 1
fi

gitroot=$(git rev-parse --show-toplevel)

VERSION="${1:-$(jq -r '.version' "${gitroot}/package.json")}"
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
    echo "::error::No version supplied and the root package.json has no 'version' field."
    exit 1
fi
echo "Workspace version: $VERSION"

set_version() {
    local file="$1"
    jq --arg version "$VERSION" '.version = $version' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    echo "  ↑ ${file#"$gitroot/"} -> $VERSION"
}

# Root package.json is the source of truth — set it first (idempotent when inheriting).
set_version "${gitroot}/package.json"

# Propagate to every publishable package (same scope as check_versions.sh).
while IFS= read -r package_json; do
    set_version "$package_json"
done < <(find "${gitroot}/packages" -name 'package.json' -not -path '*/node_modules/*')

pushd "${gitroot}" > /dev/null
pnpm install
echo "Verifying versions..."
./scripts/check_versions.sh
popd > /dev/null
