package no.komreg

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.server.application.Application
import io.ktor.server.application.log
import io.ktor.server.netty.EngineMain
import io.ktor.server.plugins.di.dependencies
import io.ktor.server.plugins.di.provide
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import no.komreg.geo.geoRoutes
import no.komreg.kjoring.AzureCliToken
import no.komreg.kjoring.KomregClient
import no.komreg.kjoring.KomregTarget
import no.komreg.kjoring.kjoringRoutes
import no.komreg.lists.ListRepository
import no.komreg.lists.listRoutes
import no.komreg.regulering.reguleringRoutes
import no.komreg.reguleringer.ReguleringerRepository
import no.komreg.reguleringer.reguleringerRoutes

// EngineMain reads src/main/resources/application.conf (port, DB, CORS, shutdown timings)
// and invokes the module named there — deployment config is data, not code.
fun main(args: Array<String>) = EngineMain.main(args)

// One outbound client, shared by the geodata proxy and the komreg-backend handoff.
// Deliberately shared: a test that swaps it (`dependencies.provide<HttpClient>`) fakes
// every upstream at once. Registered in the DI container, which closes it and the DB
// pool on shutdown (both are AutoCloseable) — no manual shutdown hook needed.
//
// Because it IS shared, the Entra token must never be a client-wide default here — see
// KomregClient.auth(). 10s is right for the geo lookups; komreg-backend's calls raise it
// per request, the way GeoRoutes' long-running queries already do.
private fun geoHttpClient() = HttpClient(CIO) {
    install(HttpTimeout) {
        requestTimeoutMillis = 10_000
        connectTimeoutMillis = 5_000
    }
}

private fun Application.testRunsEnabled(): Boolean =
    environment.config.propertyOrNull("testRuns.enabled")?.getString() == "1"

// Composition root, invoked by EngineMain (see application.conf `ktor.application.modules`).
// Registers dependencies in the DI container (which owns their construction + lifecycle),
// installs the plugins, and mounts each feature's routes under one tree.
fun Application.module() {
    val config = environment.config
    dependencies {
        provide<Database> { Database.fromConfig(config).also { it.init() } }
        provide<HttpClient> { geoHttpClient() }
        provide<ListRepository>(::ListRepository)
        provide<ReguleringerRepository>(::ReguleringerRepository)
    }

    configureSerialization()
    configureCompression()
    configureMonitoring()
    configureCors()

    val db: Database by dependencies
    val listRepo: ListRepository by dependencies
    val reguleringerRepo: ReguleringerRepository by dependencies
    val httpClient: HttpClient by dependencies

    // Which komreg-backend everything outbound points at. Read once, at boot: one
    // process is only ever pointed at one target, so there is no half-switched state
    // and nothing downstream has to carry the choice around. KomregTarget.fromConfig
    // refuses to boot on a target it cannot fully resolve.
    val target = KomregTarget.fromConfig(config)
    // Two ways to get a token, and the choice is the environment's, not the code's:
    //  - a token handed in (KOMREG_DEV_TOKEN) wins. That is how this works in a
    //    container, where there is no `az` and no Azure login — the host fetches it and
    //    passes it through. It does not refresh; restart to renew.
    //  - otherwise `az` directly, which caches and refreshes itself. Best on the host.
    // Lazy either way: nothing runs `az` until the first outbound call, so a `local` run
    // never spawns a process.
    val fastToken = config.propertyOrNull("komregBackend.${target.navn}.token")
        ?.getString()
        ?.takeIf { it.isNotBlank() }
    val scope = target.scope
    val token: (suspend () -> String)? = when {
        scope == null -> null
        fastToken != null -> suspend { fastToken }
        else -> AzureCliToken(scope)::token
    }
    val komreg = KomregClient(httpClient, target, token)
    log.info(
        "komreg-backend: {} ({}), token: {}, testkjoring: {}",
        target.navn,
        target.url,
        when {
            !target.kreverToken -> "ingen"
            fastToken != null -> "KOMREG_DEV_TOKEN"
            else -> "az-cli"
        },
        if (testRunsEnabled()) "på" else "av",
    )
    routing {
        // Outside /api: only the probes call these, and they are not part of the contract.
        healthRoutes(db)
        // Everything the frontend calls sits under one prefix. The SPA has pages at
        // /reguleringer and /kjoring too, and behind one origin a proxy can only tell a
        // page from an API call by the path.
        route("/api") {
            listRoutes(listRepo, reguleringerRepo)
            geoRoutes(httpClient)
            reguleringRoutes()
            kjoringRoutes(komreg)
            reguleringerRoutes(reguleringerRepo, komreg, testRunsEnabled())
        }
    }
}
