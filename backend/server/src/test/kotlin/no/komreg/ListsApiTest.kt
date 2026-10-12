package no.komreg

import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.utils.io.ByteReadChannel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class ListsApiTest {
    // Boot the real composition root against the test Postgres, so these exercise the full
    // module() (DI, plugins, routing) — not a hand-wired subset.
    private fun ApplicationTestBuilder.setup() {
        environment { config = MapApplicationConfig(testConfig) }
        application { module() }
    }

    @Test
    fun `crud round trip`() = testApplication {
        setup()

        // Create — the data blob is opaque; the server must store it verbatim.
        val blob = """{"selected":[1,2],"note":"æøå og \"anførselstegn\""}"""
        val created = client.post("/api/lists") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"testliste","data":$blob}""")
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val createdBody = Json.parseToJsonElement(created.bodyAsText()).jsonObject
        val id = createdBody["id"]!!.jsonPrimitive.int
        val version = createdBody["updatedAt"]!!.jsonPrimitive.content

        // The index includes it.
        val index = client.get("/api/lists")
        assertEquals(HttpStatusCode.OK, index.status)
        assertTrue(index.bodyAsText().contains("testliste"))

        // Fetch — the blob round-trips unchanged (compared as JSON, not text).
        val full = client.get("/api/lists/$id")
        assertEquals(HttpStatusCode.OK, full.status)
        val data = Json.parseToJsonElement(full.bodyAsText()).jsonObject["data"]!!
        assertEquals(Json.parseToJsonElement(blob), data)

        // Update both name and blob.
        val put = client.put("/api/lists/$id") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"nytt navn","data":{"x":1},"expectedUpdatedAt":"$version"}""")
        }
        assertEquals(HttpStatusCode.OK, put.status)
        val updated = Json.parseToJsonElement(client.get("/api/lists/$id").bodyAsText()).jsonObject
        assertEquals("nytt navn", updated["name"]!!.jsonPrimitive.content)
        assertEquals(Json.parseToJsonElement("""{"x":1}"""), updated["data"])

        // Delete, then everything 404s.
        assertEquals(HttpStatusCode.OK, client.delete("/api/lists/$id").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/lists/$id").status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/lists/$id").status)
        assertEquals(
            HttpStatusCode.NotFound,
            client.put("/api/lists/$id") {
                contentType(ContentType.Application.Json)
                setBody("""{"name":"x","data":{},"expectedUpdatedAt":"$version"}""")
            }.status,
        )
    }

    // The whole error body, pinned once: every route answers errors through the same
    // helper, so this is the shape of all of them.
    @Test
    fun `answers an error as problem json`() = testApplication {
        setup()
        val missing = client.get("/api/lists/999999")
        assertEquals(HttpStatusCode.NotFound, missing.status)
        assertEquals("application/problem+json", missing.contentType()?.withoutParameters().toString())
        assertEquals(
            Json.parseToJsonElement(
                """
                {"type":"about:blank","title":"Not Found","status":404,
                 "instance":"/api/lists/999999","kode":"finnes-ikke","feil":[]}
                """,
            ),
            Json.parseToJsonElement(missing.bodyAsText()),
        )

        // A failed body rule carries its reason in `detail`.
        val blank = client.post("/api/lists") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":" ","data":{}}""")
        }
        assertEquals(HttpStatusCode.BadRequest, blank.status)
        val problem = Json.decodeFromString<Problem>(blank.bodyAsText())
        assertEquals(Kode.UGYLDIG_FORESPORSEL, problem.kode)
        assertEquals("name must not be blank", problem.detail)
    }

    @Test
    fun `refuses a save made from a stale version`() = testApplication {
        setup()
        // Two tabs load the same list; the first saves. The second still holds the old
        // updatedAt, and its save must be refused rather than overwrite the first one.
        val created = Json.parseToJsonElement(
            client.post("/api/lists") {
                contentType(ContentType.Application.Json)
                setBody("""{"name":"delt","data":{"fra":"start"}}""")
            }.bodyAsText(),
        ).jsonObject
        val id = created["id"]!!.jsonPrimitive.int
        val loaded = created["updatedAt"]!!.jsonPrimitive.content

        val first = client.put("/api/lists/$id") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"delt","data":{"fra":"fane 1"},"expectedUpdatedAt":"$loaded"}""")
        }
        assertEquals(HttpStatusCode.OK, first.status)
        val next = Json.parseToJsonElement(first.bodyAsText()).jsonObject["updatedAt"]!!.jsonPrimitive.content

        val second = client.put("/api/lists/$id") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"delt","data":{"fra":"fane 2"},"expectedUpdatedAt":"$loaded"}""")
        }
        assertEquals(HttpStatusCode.Conflict, second.status)
        // The code is what tells this 409 from "in use" — the frontend branches on it.
        assertEquals(Kode.ENDRET_SIDEN_LASTING, Json.decodeFromString<Problem>(second.bodyAsText()).kode)
        val stored = Json.parseToJsonElement(client.get("/api/lists/$id").bodyAsText()).jsonObject
        assertEquals(Json.parseToJsonElement("""{"fra":"fane 1"}"""), stored["data"])

        // The version the first save returned is the one that works next.
        assertEquals(
            HttpStatusCode.OK,
            client.put("/api/lists/$id") {
                contentType(ContentType.Application.Json)
                setBody("""{"name":"delt","data":{"fra":"fane 1 igjen"},"expectedUpdatedAt":"$next"}""")
            }.status,
        )
    }

    @Test
    fun `rejects bad input`() = testApplication {
        setup()
        // Non-numeric id.
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/lists/abc").status)
        // A query param must not smuggle an id past the path: call.parameters merges
        // query + path with query winning, so handlers read call.pathParameters.
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/lists/abc?id=1").status)
        // Blank name.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.post("/api/lists") {
                contentType(ContentType.Application.Json)
                setBody("""{"name":"   ","data":{}}""")
            }.status,
        )
        // Malformed JSON is a client error — must not fall into the StatusPages
        // Throwable catch-all and come back as a 500.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.post("/api/lists") {
                contentType(ContentType.Application.Json)
                setBody("""{"name":"x","data":""")
            }.status,
        )
        // Same for a body that isn't JSON at all.
        assertEquals(
            HttpStatusCode.UnsupportedMediaType,
            client.post("/api/lists") {
                contentType(ContentType.Text.Plain)
                setBody("""{"name":"x","data":{}}""")
            }.status,
        )
    }

    @Test
    fun `tolerates unknown fields from a newer client`() = testApplication {
        setup()
        // Version skew during a rolling deploy: a newer frontend may send fields this
        // build doesn't know. ignoreUnknownKeys drops them instead of 400-ing the save.
        assertEquals(
            HttpStatusCode.Created,
            client.post("/api/lists") {
                contentType(ContentType.Application.Json)
                setBody("""{"name":"skew","data":{},"fieldFromTheFuture":true}""")
            }.status,
        )
    }

    @Test
    fun `caps oversized bodies`() = testApplication {
        setup()
        // Just over the 32 MiB cap (MAX_LIST_BYTES in ListRoutes).
        val big = ByteArray(33 * 1024 * 1024)

        // Declared via Content-Length: rejected from the header alone.
        assertEquals(
            HttpStatusCode.PayloadTooLarge,
            client.post("/api/lists") {
                contentType(ContentType.Application.Json)
                setBody(big)
            }.status,
        )

        // Streamed with no Content-Length (chunked): the limit must trigger while the
        // body streams in, since there is no header to check up front.
        assertEquals(
            HttpStatusCode.PayloadTooLarge,
            client.post("/api/lists") {
                contentType(ContentType.Application.Json)
                setBody(ByteReadChannel(big))
            }.status,
        )
    }
}
