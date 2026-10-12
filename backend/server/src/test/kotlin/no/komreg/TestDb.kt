package no.komreg

import org.testcontainers.postgresql.PostgreSQLContainer

// One Postgres container for the whole test run (Testcontainers' reaper cleans it up
// afterwards). Tests boot the real module() against it (via testConfig) and share the
// database, so each test uses its own rows / cache keys instead of truncating.
private val pg: PostgreSQLContainer by lazy {
    PostgreSQLContainer("postgres:18").also { it.start() }
}

/**
 * The minimum config `module()` needs to boot in a test, fed to it through the test
 * application's config.
 *
 * It carries more than `db.*` on purpose. Tests build a [io.ktor.server.config.MapApplicationConfig]
 * instead of loading `application.conf`, so **none of that file's defaults reach them** — and
 * `module()` resolves `KomregTarget` at boot, which by design refuses to start on a missing
 * url rather than quietly falling back. The result: every test that booted `module()` without
 * naming a komreg url failed at startup, while the two test files written alongside the
 * `kjoring/` slice happened to set one inline and passed. Anything `module()` requires to boot
 * belongs here, so a new slice with a boot-time check doesn't silently red the older suites.
 *
 * A test that cares about the target overrides these by appending its own pairs — later
 * entries win — the way KjoringApiTest and ReguleringerApiTest do.
 */
val testConfig: List<Pair<String, String>> by lazy {
    listOf(
        "db.url" to pg.jdbcUrl,
        "db.user" to pg.username,
        "db.password" to pg.password,
        // .invalid never resolves (RFC 2606), so a test that reaches komreg-backend for real
        // fails fast with a DNS error instead of quietly hitting whatever is on localhost.
        // The tests that exercise that path swap in a MockEngine anyway.
        "komregBackend.local.url" to "http://komreg-backend.invalid",
    )
}
