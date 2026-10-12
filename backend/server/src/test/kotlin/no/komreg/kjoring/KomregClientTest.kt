package no.komreg.kjoring

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

// The token lives here rather than in KjoringApiTest because the az call is injectable
// at this level: no server, no DI, and nothing that needs az installed.
private val LOCAL = KomregTarget("local", "http://localhost:8081", scope = null)
private val DEV = KomregTarget("dev", "https://komreg-dev", scope = "client-id/.default")

class KomregClientTest {
    private fun engine(capture: (io.ktor.client.request.HttpRequestData) -> Unit = {}) =
        HttpClient(
            MockEngine { request ->
                capture(request)
                respond("ok", HttpStatusCode.OK)
            },
        )

    @Test
    fun `local sends no Authorization header`() = runBlocking {
        var auth: String? = "sentinel"
        val komreg = KomregClient(engine { auth = it.headers[HttpHeaders.Authorization] }, LOCAL, token = null)

        assertTrue(komreg.send("{}").ok)
        assertNull(auth)
    }

    @Test
    fun `dev attaches the bearer token and posts the payload verbatim`() = runBlocking {
        var auth: String? = null
        var url: String? = null
        var body: String? = null
        val komreg = KomregClient(
            engine {
                auth = it.headers[HttpHeaders.Authorization]
                url = it.url.toString()
                body = (it.body as TextContent).text
            },
            DEV,
            { "token-abc" },
        )

        // Ugly on purpose: this is the string kotlinx produced, and it is kotlinx — not
        // our parser — that decides what komreg-backend's strict decoder receives.
        val payload = """{"id":"reg-1",  "navn":"Test", "endringer":[]}"""
        assertTrue(komreg.send(payload).ok)

        assertEquals("Bearer token-abc", auth)
        assertEquals("https://komreg-dev/reguleringer", url)
        assertEquals(payload, body)
    }

    @Test
    fun `start is a GET to run, however irreversible it is`() = runBlocking {
        var url: String? = null
        var method: HttpMethod? = null
        val komreg = KomregClient(
            engine {
                url = it.url.toString()
                method = it.method
            },
            DEV,
            { "t" },
        )

        komreg.start("kommuneendring-2028")

        assertEquals(HttpMethod.Get, method)
        assertEquals("https://komreg-dev/run/kommuneendring-2028", url)
    }

    @Test
    fun `the token is fetched once and reused`() = runBlocking {
        // Loading /kjoring fires miljo + reguleringer + status at the same time; without
        // the mutex that would be three az processes.
        var hentet = 0
        val komreg = KomregClient(
            engine(),
            DEV,
            // The real thing here: the caching is what this test is about.
            AzureCliToken(DEV.scope!!) {
                hentet++
                "t"
            }::token,
        )

        komreg.send("{}")
        komreg.send("{}")
        komreg.miljo()

        assertEquals(1, hentet)
    }

    @Test
    fun `an upstream 500 keeps its message instead of becoming unreachable`() = runBlocking {
        // A duplicate id is komreg-backend's generic "Failed to save Regulering." 500 —
        // its POST has no 400 at all, so that text is the whole diagnostic.
        val komreg = KomregClient(
            HttpClient(MockEngine { respond("Failed to save Regulering.", HttpStatusCode.InternalServerError) }),
            LOCAL,
            token = null,
        )

        val r = komreg.send("{}")

        assertTrue(r.reached)
        assertFalse(r.ok)
        assertEquals(500, r.status)
        assertEquals("Failed to save Regulering.", r.message)
    }

    @Test
    fun `a token failure never reaches komreg-backend and says what to do`() = runBlocking {
        var hits = 0
        val komreg = KomregClient(
            HttpClient(
                MockEngine {
                    hits++
                    respond("", HttpStatusCode.OK)
                },
            ),
            DEV,
            { throw TokenFeil("Ikke innlogget i Azure. Kjør «az login --allow-no-subscriptions».") },
        )

        val r = komreg.send("{}")

        assertEquals(0, hits, "uten token skal ingenting sendes")
        assertFalse(r.reached)
        assertNull(r.status)
        assertContains(r.message, "az login")
    }

    @Test
    fun `an unreachable dev target asks about the network, a local one about the process`() = runBlocking {
        val nede = HttpClient(MockEngine { throw java.io.IOException("connection refused") })

        // atkv3-dev is on kartverket-intern.cloud, so "is it running?" is the wrong
        // question there and "are you on VPN?" is the right one.
        assertContains(KomregClient(nede, DEV, { "t" }).send("{}").message, "VPN")
        assertContains(KomregClient(nede, LOCAL, null).send("{}").message, "Kjører den?")
    }

    @Test
    fun `miljo reports the target and the token problem, never the token`() = runBlocking {
        assertEquals(
            Miljo("local", LOCAL.url, kreverToken = false, tokenOk = true),
            KomregClient(engine(), LOCAL, null).miljo(),
        )

        val ok = KomregClient(engine(), DEV, { "hemmelig" }).miljo()
        assertTrue(ok.kreverToken)
        assertTrue(ok.tokenOk)
        assertFalse(ok.toString().contains("hemmelig"), "token-verdien skal aldri ut av backend")

        val feil = KomregClient(engine(), DEV, { throw TokenFeil("az login") }).miljo()
        assertFalse(feil.tokenOk)
        assertEquals("az login", feil.tokenFeil)
    }
}
