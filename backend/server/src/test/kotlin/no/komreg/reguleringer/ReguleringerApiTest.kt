package no.komreg.reguleringer

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.plugins.di.dependencies
import io.ktor.server.plugins.di.provide
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.komreg.module
import no.komreg.testConfig

class ReguleringerApiTest {
    private val json = Json { ignoreUnknownKeys = true }

    // The number of calls to komreg-backend's /run, per test. Send-without-start stands or
    // falls on this being 0, so it is counted instead of inferred from the status we write.
    private var runHits = 0

    private fun ApplicationTestBuilder.boot(kjorer: Boolean = false, onRun: suspend () -> Unit = {}) {
        environment {
            config = MapApplicationConfig(
                testConfig + listOf(
                    "testRuns.enabled" to "1",
                    // Default target: no token, so nothing here shells out to az.
                    "komregBackend.local.url" to "http://komreg-test",
                ),
            )
        }
        application {
            dependencies.provide<HttpClient> {
                HttpClient(
                    MockEngine { request ->
                        when (request.url.encodedPath) {
                            // Still answered, but no test run asks: the parameter is only
                            // here to show that a `true` does NOT stop a kjøring.
                            "/is-running" -> respond(kjorer.toString(), HttpStatusCode.OK)
                            "/reguleringer" -> respond("saved", HttpStatusCode.OK)
                            else -> {
                                if (request.url.encodedPath.startsWith("/run/")) {
                                    runHits++
                                    onRun()
                                }
                                respond("started", HttpStatusCode.OK)
                            }
                        }
                    },
                )
            }
            module()
        }
    }

    private suspend fun HttpClient.createList(name: String): Int {
        val r = post("/api/lists") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"$name","data":{}}""")
        }
        return Json.parseToJsonElement(r.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
    }

    // The separate start, naming the komreg-backend the test booted against unless told otherwise.
    private suspend fun HttpClient.startSendt(regId: Int, runId: Long, url: String = "http://komreg-test") =
        post("/api/reguleringer/$regId/testkjoringer/$runId/start") {
            contentType(ContentType.Application.Json)
            setBody("""{"expectedKomregUrl":"$url"}""")
        }

    // One source, as the API wants it: the list's id plus the exact name and updatedAt the
    // client read. The backend rejects the run if either has moved, so both tests build it
    // the same way rather than each spelling out a snapshot that has to stay in step.
    private fun sourceJson(listId: Int, list: JsonObject): String {
        val name = json.encodeToString(list["name"]!!.jsonPrimitive.content)
        val updatedAt = json.encodeToString(list["updatedAt"]!!.jsonPrimitive.content)
        return """{"listId":$listId,"name":$name,"updatedAt":$updatedAt}"""
    }

    @Test
    fun `a run may use one member and snapshots its exact payload`() = testApplication {
        boot()
        val suffix = UUID.randomUUID().toString().take(8)
        val first = client.createList("2027 A $suffix")
        val second = client.createList("2027 B $suffix")
        val outsider = client.createList("2028 $suffix")
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"baseId":"r-$suffix","navn":"2027","dato":"2027-01-01","listIds":[$first,$second]}""")
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val reg = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        val list = Json.parseToJsonElement(client.get("/api/lists/$first").bodyAsText()).jsonObject
        val body = """{
          "expectedKomregUrl":"http://komreg-test","expectedReguleringUpdatedAt":${json.encodeToString(
            reg["updatedAt"]!!.jsonPrimitive.content,
        )},
          "sources":[${sourceJson(first, list)}],
          "rader":[{"id":"t:1","type":"teig","kommunenummer":"3201","nyKommunenummer":"3203","teigid":"1"}]
        }"""
        val run = client.post("/api/reguleringer/$regId/testkjoringer") {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        assertEquals(HttpStatusCode.OK, run.status)
        val result = json.decodeFromString<TestRunSummary>(run.bodyAsText())
        assertEquals("start_accepted", result.status)
        assertEquals(listOf(first), result.sources.map { it.listId })
        assertTrue(result.externalId.startsWith("r-$suffix-t-"))

        val payload = client.get("/api/reguleringer/$regId/testkjoringer/${result.id}/payload")
        assertEquals(HttpStatusCode.OK, payload.status)
        assertEquals(
            result.externalId,
            Json.parseToJsonElement(payload.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content,
        )

        val outsiderFull = Json.parseToJsonElement(client.get("/api/lists/$outsider").bodyAsText()).jsonObject
        val invalid = body.replace("\"listId\":$first", "\"listId\":$outsider")
            .replace(list["name"]!!.jsonPrimitive.content, outsiderFull["name"]!!.jsonPrimitive.content)
            .replace(list["updatedAt"]!!.jsonPrimitive.content, outsiderFull["updatedAt"]!!.jsonPrimitive.content)
        val refused = client.post("/api/reguleringer/$regId/testkjoringer") {
            contentType(ContentType.Application.Json)
            setBody(invalid)
        }
        assertEquals(HttpStatusCode.Conflict, refused.status)
    }

    // Regression test: /is-running must not be able to stop a test run. It is also true for
    // IKKE_TILBAKEFØRT — a resting state — so a guard here stayed locked for good after the
    // first test run nobody rolled back. See ReguleringerService.kjorTestkjoring.
    @Test
    fun `a run proceeds even when komreg-backend reports is-running`() = testApplication {
        boot(kjorer = true)
        val suffix = UUID.randomUUID().toString().take(8)
        val listId = client.createList("2027 $suffix")
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"baseId":"b-$suffix","navn":"2027","dato":"2027-01-01","listIds":[$listId]}""")
        }
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val reg = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        val list = Json.parseToJsonElement(client.get("/api/lists/$listId").bodyAsText()).jsonObject
        val run = client.post("/api/reguleringer/$regId/testkjoringer") {
            contentType(ContentType.Application.Json)
            setBody(
                """{
                  "expectedKomregUrl":"http://komreg-test","expectedReguleringUpdatedAt":${json.encodeToString(
                    reg["updatedAt"]!!.jsonPrimitive.content,
                )},
                  "sources":[${sourceJson(listId, list)}],
                  "rader":[{"id":"t:1","type":"teig","kommunenummer":"3201","nyKommunenummer":"3203","teigid":"1"}]
                }""",
            )
        }

        assertEquals(HttpStatusCode.OK, run.status)
        assertEquals("start_accepted", json.decodeFromString<TestRunSummary>(run.bodyAsText()).status)
        // And it is journalled, like any other kjøring.
        assertEquals(
            1,
            Json.parseToJsonElement(client.get("/api/reguleringer/$regId/testkjoringer").bodyAsText()).jsonArray.size,
        )
    }

    @Test
    fun `send without start leaves the run sent, and start runs it exactly once`() = testApplication {
        boot()
        val suffix = UUID.randomUUID().toString().take(8)
        val listId = client.createList("2027 $suffix")
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"baseId":"s-$suffix","navn":"2027","dato":"2027-01-01","listIds":[$listId]}""")
        }
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val reg = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        val list = Json.parseToJsonElement(client.get("/api/lists/$listId").bodyAsText()).jsonObject
        val sent = client.post("/api/reguleringer/$regId/testkjoringer") {
            contentType(ContentType.Application.Json)
            setBody(
                """{
                  "expectedKomregUrl":"http://komreg-test","expectedReguleringUpdatedAt":${json.encodeToString(
                    reg["updatedAt"]!!.jsonPrimitive.content,
                )},
                  "sources":[${sourceJson(listId, list)}],
                  "rader":[{"id":"t:1","type":"teig","kommunenummer":"3201","nyKommunenummer":"3203","teigid":"1"}],
                  "start":false
                }""",
            )
        }
        assertEquals(HttpStatusCode.OK, sent.status)
        val run = json.decodeFromString<TestRunSummary>(sent.bodyAsText())
        assertEquals("sent", run.status)
        assertEquals(0, runHits)

        val started = client.startSendt(regId, run.id)
        assertEquals(HttpStatusCode.OK, started.status)
        val after = json.decodeFromString<TestRunSummary>(started.bodyAsText())
        assertEquals("start_accepted", after.status)
        assertEquals(run.externalId, after.externalId)
        assertEquals(1, runHits)

        // Second attempt: the row is no longer in `sent`, and /run is not reached again.
        assertEquals(
            HttpStatusCode.Conflict,
            client.startSendt(regId, run.id).status,
        )
        assertEquals(1, runHits)
        assertEquals(
            HttpStatusCode.NotFound,
            client.startSendt(regId, 999999999).status,
        )
    }

    // Regression test: the target follows the backend process, and the page used to name the
    // one it read when it loaded. A restart against dev then left a confirm saying LOCAL in
    // front of a run that went to dev. Now the client names what it showed, and both steps
    // refuse a mismatch before they journal, send or claim anything.
    @Test
    fun `a run that names another komreg-backend is refused, and costs nothing`() = testApplication {
        boot()
        val suffix = UUID.randomUUID().toString().take(8)
        val listId = client.createList("2027 $suffix")
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"baseId":"m-$suffix","navn":"2027","dato":"2027-01-01","listIds":[$listId]}""")
        }
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val reg = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        val list = Json.parseToJsonElement(client.get("/api/lists/$listId").bodyAsText()).jsonObject
        suspend fun send(url: String) = client.post("/api/reguleringer/$regId/testkjoringer") {
            contentType(ContentType.Application.Json)
            setBody(
                """{
                  "expectedKomregUrl":"$url",
                  "expectedReguleringUpdatedAt":${json.encodeToString(reg["updatedAt"]!!.jsonPrimitive.content)},
                  "sources":[${sourceJson(listId, list)}],
                  "rader":[{"id":"t:1","type":"teig","kommunenummer":"3201","nyKommunenummer":"3203","teigid":"1"}],
                  "start":false
                }""",
            )
        }

        val refused = send("http://komreg-elsewhere")
        assertEquals(HttpStatusCode.Conflict, refused.status)
        // The refusal says where the backend points, so the user can see what moved.
        assertContains(refused.bodyAsText(), "LOCAL (http://komreg-test)")
        assertEquals("[]", client.get("/api/reguleringer/$regId/testkjoringer").bodyAsText())

        val run = json.decodeFromString<TestRunSummary>(send("http://komreg-test").bodyAsText())
        assertEquals("sent", run.status)

        assertEquals(HttpStatusCode.Conflict, client.startSendt(regId, run.id, "http://komreg-elsewhere").status)
        assertEquals(0, runHits)
        // The refused start did not use up the run's one start.
        val started = client.startSendt(regId, run.id)
        assertEquals("start_accepted", json.decodeFromString<TestRunSummary>(started.bodyAsText()).status)
        assertEquals(1, runHits)
    }

    @Test
    fun `automatic start claims the run before a concurrent manual start`() = testApplication {
        val runStarted = CompletableDeferred<Unit>()
        val releaseRun = CompletableDeferred<Unit>()
        boot(onRun = {
            if (runHits == 1) {
                runStarted.complete(Unit)
                releaseRun.await()
            }
        })
        val suffix = UUID.randomUUID().toString().take(8)
        val listId = client.createList("2027 $suffix")
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"baseId":"a-$suffix","navn":"2027","dato":"2027-01-01","listIds":[$listId]}""")
        }
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val reg = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        val list = Json.parseToJsonElement(client.get("/api/lists/$listId").bodyAsText()).jsonObject

        coroutineScope {
            val automatic = async {
                client.post("/api/reguleringer/$regId/testkjoringer") {
                    contentType(ContentType.Application.Json)
                    setBody(
                        """{
                          "expectedKomregUrl":"http://komreg-test","expectedReguleringUpdatedAt":${json.encodeToString(
                            reg["updatedAt"]!!.jsonPrimitive.content,
                        )},
                          "sources":[${sourceJson(listId, list)}],
                          "rader":[{"id":"t:1","type":"teig","kommunenummer":"3201","nyKommunenummer":"3203","teigid":"1"}]
                        }""",
                    )
                }
            }
            try {
                withTimeout(10_000) {
                    runStarted.await()
                    val runs = json.decodeFromString<List<TestRunSummary>>(
                        client.get("/api/reguleringer/$regId/testkjoringer").bodyAsText(),
                    )
                    val inFlight = runs.single()
                    val manual = client.startSendt(regId, inFlight.id)
                    assertEquals(HttpStatusCode.Conflict, manual.status)
                    assertEquals("start_unknown", inFlight.status)
                    assertEquals(1, runHits)
                }
            } finally {
                releaseRun.complete(Unit)
            }
            val completed = automatic.await()
            assertEquals(HttpStatusCode.OK, completed.status)
            assertEquals("start_accepted", json.decodeFromString<TestRunSummary>(completed.bodyAsText()).status)
            assertEquals(1, runHits)
        }
    }

    @Test
    fun `referenced lists are protected and reguleringer are archived`() = testApplication {
        boot()
        val suffix = UUID.randomUUID().toString().take(8)
        val listId = client.createList("protected $suffix")
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody(
                """{"baseId":"p-$suffix","navn":"Protected","dato":"2027-01-01","listIds":[$listId]}""",
            )
        }
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val blocked = client.delete("/api/lists/$listId")
        assertEquals(HttpStatusCode.Conflict, blocked.status)
        assertContains(blocked.bodyAsText(), "Protected")
        assertEquals(HttpStatusCode.OK, client.post("/api/reguleringer/$regId/arkiver").status)
        val active = Json.parseToJsonElement(client.get("/api/reguleringer").bodyAsText()).jsonArray
        assertTrue(active.none { it.jsonObject["id"]!!.jsonPrimitive.int == regId })
        val all = Json.parseToJsonElement(client.get("/api/reguleringer?arkiverte=1").bodyAsText()).jsonArray
        assertTrue(all.any { it.jsonObject["id"]!!.jsonPrimitive.int == regId })
    }

    @Test
    fun `forced delete removes the list from its reguleringer, archived ones included`() = testApplication {
        boot()
        val suffix = UUID.randomUUID().toString().take(8)
        val listId = client.createList("forced $suffix")
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody(
                """{"baseId":"f-$suffix","navn":"Forced","dato":"2027-01-01","listIds":[$listId]}""",
            )
        }
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val before = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        assertEquals(HttpStatusCode.OK, client.post("/api/reguleringer/$regId/arkiver").status)
        assertEquals(HttpStatusCode.Conflict, client.delete("/api/lists/$listId").status)

        assertEquals(HttpStatusCode.OK, client.delete("/api/lists/$listId?force=1").status)

        assertEquals(HttpStatusCode.NotFound, client.get("/api/lists/$listId").status)
        val after = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        assertTrue(after["listIds"]!!.jsonArray.isEmpty())
        assertTrue(after["updatedAt"] != before["updatedAt"])
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/lists/$listId?force=1").status)
    }

    @Test
    fun `a create without baseId gets one minted from navn`() = testApplication {
        boot()
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"navn":"Stranda til Fjord","dato":"2027-01-01","listIds":[]}""")
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val regId = Json.parseToJsonElement(created.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.int
        val baseId = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText())
            .jsonObject["baseId"]!!.jsonPrimitive.content
        assertTrue(baseId.startsWith("stranda-til-fjord-"), "uventet base-id: $baseId")
        assertTrue(Regex("^[A-Za-z0-9_-]{1,48}$").matches(baseId))
    }
}
