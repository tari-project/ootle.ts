# Test-only fixtures and fakes

Modules in this directory are reusable helpers for unit tests in
`@tari-project/ootle`. They are deliberately **not** re-exported from the
package's `index.ts`, so they never reach external consumers; tests import them
by relative path (`import { fakeProvider } from "../test/fake-provider"`).

If a fixture is genuinely needed by another package's tests, expose it via a
dedicated `test-fixtures` subpath export. The default is per-package locality.
