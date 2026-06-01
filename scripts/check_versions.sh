#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Verify every publishable package under packages/ inherits the workspace version.
#
# The root package.json `version` is the single source of truth (the "workspace
# version"). Every packages/*/package.json must match it. Bump it everywhere with
# ./scripts/set_package_versions.sh (or `pnpm version:set <version>`).

gitroot=$(git rev-parse --show-toplevel)

if [[ ! -d "${gitroot}/packages" ]]; then
    echo "❌ ::error::Expected workspace directory '${gitroot}/packages' does not exist."
    exit 1
fi

workspace_version=$(jq -r '.version' "${gitroot}/package.json")
if [[ -z "$workspace_version" || "$workspace_version" == "null" ]]; then
    echo "❌ ::error::Could not find 'version' field in the root package.json (the workspace version)."
    exit 1
fi
echo "Workspace version (root package.json): $workspace_version"

mismatch=false
checked_any=false
# Match only each package's own manifest (packages/<pkg>/package.json) via -mindepth/-maxdepth,
# never nested package.json files in dist/, build output, or test fixtures.
while IFS= read -r file; do
    checked_any=true
    version=$(jq -r '.version' "$file")
    if [[ -z "$version" || "$version" == "null" ]]; then
        echo "❌ ::error::Could not find 'version' field in $file"
        exit 1
    fi
    if [[ "$version" != "$workspace_version" ]]; then
        echo "❌ ::error::$file is at '$version' but the workspace version is '$workspace_version'."
        mismatch=true
    else
        echo "  ✓ $file @ $version"
    fi
done < <(find "${gitroot}/packages" -mindepth 2 -maxdepth 2 -name 'package.json' -not -path '*/node_modules/*')

if [[ "$checked_any" == "false" ]]; then
    echo "❌ ::error::No package.json files found under ${gitroot}/packages — nothing was checked."
    exit 1
fi

if [ "$mismatch" = true ]; then
    echo "❌ ::error::One or more packages do not inherit the workspace version '$workspace_version'."
    echo "   Run ./scripts/set_package_versions.sh ${workspace_version} (or 'pnpm version:set ${workspace_version}') to sync."
    exit 1
fi

echo "✅ All packages inherit the workspace version: $workspace_version"
