package no.komreg.regulering

import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import no.komreg.Problem
import no.komreg.module
import no.komreg.testConfig

private val json = Json { ignoreUnknownKeys = true }

private val GYLDIG = """
    {
      "id": "grensejustering-2027",
      "navn": "Grensejusteringer 2027",
      "dato": "2027-01-01",
      "rader": [
        {
          "id": "m:5060-90/4", "type": "matrikkelenhet",
          "kommunenummer": "5060", "nyKommunenummer": "1811",
          "gardsnummer": "90", "bruksnummer": "4",
          "nyGardsnummer": "290", "nyBruksnummer": "4"
        }
      ]
    }
""".trimIndent()

class ReguleringApiTest {

    private fun test(body: String, block: suspend (HttpStatusCode, String) -> Unit) =
        testApplication {
            environment { config = MapApplicationConfig(testConfig) }
            application { module() }
            val res = client.post("/api/regulering") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            block(res.status, res.bodyAsText())
        }

    @Test
    fun `generates the combined file and one per kommunepar`() = test(GYLDIG) { status, body ->
        assertEquals(HttpStatusCode.OK, status)
        val res = json.decodeFromString<GenererResponse>(body)
        assertEquals("grensejustering-2027-samlet.json", res.samlet.filnavn)
        assertEquals(1, res.perPar.size)
        assertEquals("5060-1811", res.perPar.single().key)
        // The json field is the already serialized payload, not a nested object.
        assertTrue(res.samlet.json.startsWith("{\n"))
    }

    @Test
    fun `answers 400 with every row error collected`() = test(
        GYLDIG.replace(""""nyKommunenummer": "1811"""", """"nyKommunenummer": """""),
    ) { status, body ->
        assertEquals(HttpStatusCode.BadRequest, status)
        val feil = json.decodeFromString<Problem>(body).feil.map { it.melding }
        assertTrue(feil.any { "mangler ny kommune" in it }, "fikk $feil")
    }

    @Test
    fun `answers 400 on invalid metadata before the rows are checked`() = test(
        GYLDIG.replace(""""dato": "2027-01-01"""", """"dato": "01.01.2027""""),
    ) { status, body ->
        assertEquals(HttpStatusCode.BadRequest, status)
        assertTrue("ÅÅÅÅ-MM-DD" in json.decodeFromString<Problem>(body).feil.joinToString { it.melding })
    }
}
