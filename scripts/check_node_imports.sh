#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Verify every built package under packages/ can be imported by plain Node.
#
# Run after the packages are built. Each package is imported by name from its own
# directory, so Node resolves it through the package's `exports` map and loads the
# built dist with its native ES module loader, as a consumer's Node process would.
#
# Neither the tests nor the example builds cover this: Vitest and Vite load modules
# with their own resolver, which accepts dependencies that Node itself rejects (for
# example a dependency that is not a valid Node ES module).

gitroot=$(git rev-parse --show-toplevel)

failed=false
checked_any=false
while IFS= read -r file; do
    checked_any=true
    dir=$(dirname "$file")
    name=$(jq -r '.name' "$file")
    # --experimental-wasm-modules lets Node import @tari-project/ootle-wasm's .wasm file.
    if (cd "$dir" && NODE_NO_WARNINGS=1 node --experimental-wasm-modules --input-type=module \
        -e 'await import(process.argv[1])' "$name"); then
        echo "✅ $name"
    else
        echo "❌ ::error file=${file#"${gitroot}/"}::$name cannot be imported in Node (see the error above)."
        failed=true
    fi
done < <(find "${gitroot}/packages" -mindepth 2 -maxdepth 2 -name package.json | sort)

if [[ "$checked_any" == false ]]; then
    echo "❌ ::error::No packages/*/package.json files found; nothing was checked."
    exit 1
fi

if [[ "$failed" == true ]]; then
    exit 1
fi
