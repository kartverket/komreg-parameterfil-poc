package no.komreg.kjoring

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.plugins.di.dependencies
import io.ktor.server.plugins.di.provide
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlinx.serialization.json.Json
import no.komreg.module
import no.komreg.testConfig

// komreg-backend has no ktor-server-test-host and no HTTP stub of its own to borrow, so
// it is faked from this side with MockEngine — the same shape GeoApiTest uses for the
// Geonorge upstreams. The whole HttpClient is swapped, so these tests also pin the URLs
// we build, which is the part a typo would break silently.
//
// The token itself is tested in KomregClientTest, where the az call is injectable;
// nothing here needs az installed.
private const val LOCAL = "http://komreg-local:9999"
private const val DEV = "https://komreg-dev:8443"

class KjoringApiTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun ApplicationTestBuilder.boot(upstream: HttpClient, target: String = "local") {
        environment {
            config = MapApplicationConfig(
                testConfig + listOf(
                    "komregBackend.target" to target,
                    "komregBackend.local.url" to LOCAL,
                    "komregBackend.dev.url" to DEV,
                    "komregBackend.dev.clientId" to "test-client-id",
                ),
            )
        }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }
    }

    @Test
    fun `the reguleringer listing is reduced to summaries`() = testApplication {
        // The real response carries every transformasjon of every endring; a 2028 run is
        // tens of thousands. They are counted here and only the counts cross back.
        val full = """
            [
              {"id":"vest_lofoten","navn":"Vest-Lofoten","dato":"2028-01-01",
               "endringer":[{"id":"a","transformasjoner":[{"type":"teig"},{"type":"veg"},{"type":"teig"}]},
                            {"id":"b","transformasjoner":[{"type":"veg"}]}]},
              {"id":"gran","navn":"Gran","dato":"2028-01-01","endringer":[]}
            ]
        """.trimIndent()
        var url: String? = null
        boot(
            HttpClient(
                MockEngine { request ->
                    url = request.url.toString()
                    respond(full, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                },
            ),
        )

        val r = client.get("/api/kjoring/reguleringer")

        assertEquals(HttpStatusCode.OK, r.status)
        assertEquals("$LOCAL/reguleringer", url)
        val body = r.bodyAsText()
        assertEquals(
            listOf(
                // Counted across endringer, not per endring: 2 teig + 2 veg over the two.
                ReguleringSammendrag(
                    "vest_lofoten",
                    "Vest-Lofoten",
                    "2028-01-01",
                    antallEndringer = 2,
                    antallTransformasjoner = 4,
                    transformasjonerPerType = mapOf("teig" to 2, "veg" to 2),
                ),
                ReguleringSammendrag("gran", "Gran", "2028-01-01", 0, 0, emptyMap()),
            ),
            json.decodeFromString<List<ReguleringSammendrag>>(body),
        )
        // The counts cross; the transformasjoner themselves do not. Their `type`
        // discriminator is the tell — in the summary it is a map key, never a field.
        assertFalse(body.contains("\"type\""), "transformasjonene skal ikke passere")
    }

    @Test
    fun `status unwraps the bare boolean`() = testApplication {
        boot(HttpClient(MockEngine { respond("true", HttpStatusCode.OK) }))
        assertEquals(
            StatusResponse(true),
            json.decodeFromString<StatusResponse>(client.get("/api/kjoring/status").bodyAsText()),
        )
    }

    @Test
    fun `a nonsense listing from upstream is 502, not 500`() = testApplication {
        boot(HttpClient(MockEngine { respond("""{"nope":true}""", HttpStatusCode.OK) }))
        assertEquals(HttpStatusCode.BadGateway, client.get("/api/kjoring/reguleringer").status)
    }

    @Test
    fun `an upstream failure is 502`() = testApplication {
        boot(HttpClient(MockEngine { respond("nei", HttpStatusCode.InternalServerError) }))
        assertEquals(HttpStatusCode.BadGateway, client.get("/api/kjoring/reguleringer").status)
    }

    @Test
    fun `local sends no Authorization header, and miljo says so`() = testApplication {
        var auth: String? = "sentinel"
        boot(
            HttpClient(
                MockEngine { request ->
                    auth = request.headers[HttpHeaders.Authorization]
                    respond("[]", HttpStatusCode.OK)
                },
            ),
        )

        assertEquals(HttpStatusCode.OK, client.get("/api/kjoring/reguleringer").status)
        assertNull(auth, "local skal ikke sende token")

        val miljo = json.decodeFromString<Miljo>(client.get("/api/kjoring/miljo").bodyAsText())
        assertEquals(Miljo("local", LOCAL, kreverToken = false, tokenOk = true), miljo)
    }

    @Test
    fun `the geo proxy carries no token even while the target is dev`() = testApplication {
        // The regression this change most invites: the HttpClient is shared, so a
        // client-wide `defaultRequest { bearerAuth(…) }` — the tidier-looking way to
        // write the token in — would ship a Kartverket-internal Entra token to
        // ws.geonorge.no on every address lookup.
        var auth: String? = "sentinel"
        boot(
            HttpClient(
                MockEngine { request ->
                    auth = request.headers[HttpHeaders.Authorization]
                    respond(
                        """{"adresser":[]}""",
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, "application/json"),
                    )
                },
            ),
            target = "dev",
        )

        val r = client.get("/api/geo/addresses?kommunenummer=1101&gardsnummer=42")

        assertEquals(HttpStatusCode.OK, r.status)
        assertNull(auth, "geo-oppslag skal aldri bære Entra-token")
    }
}
