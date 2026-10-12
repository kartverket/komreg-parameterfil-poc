package no.komreg.reguleringer

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.plugins.di.dependencies
import io.ktor.server.plugins.di.provide
import io.ktor.server.testing.testApplication
import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.komreg.module
import no.komreg.testConfig

class ReguleringerConcurrencyTest {
    @Test
    fun `a database lock timeout is not reported as invalid membership`() = testApplication {
        environment { config = MapApplicationConfig(testConfig + ("db.runtime.lockTimeoutSeconds" to "1")) }
        application { module() }
        val created = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"navn":"Timeout","dato":"2027-01-01","listIds":[]}""")
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val regId = Json.parseToJsonElement(
            created.bodyAsText(),
        ).jsonObject.getValue("id").jsonPrimitive.content.toInt()
        val before = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        val dbConfig = testConfig.toMap()
        withContext(Dispatchers.IO) {
            DriverManager.getConnection(
                dbConfig.getValue("db.url"),
                dbConfig.getValue("db.user"),
                dbConfig.getValue("db.password"),
            ).use { editor ->
                editor.autoCommit = false
                try {
                    editor.prepareStatement("UPDATE reguleringer SET navn = 'uncommitted' WHERE id = ?").use {
                        it.setInt(1, regId)
                        it.executeUpdate()
                    }
                    val result = client.put("/api/reguleringer/$regId") {
                        contentType(ContentType.Application.Json)
                        setBody(
                            """{"baseId":${before.getValue("baseId")},"navn":"Saved","dato":"2027-01-01",
                               "listIds":[],"expectedUpdatedAt":${before.getValue("updatedAt")}}""",
                        )
                    }
                    assertEquals(HttpStatusCode.InternalServerError, result.status)
                } finally {
                    editor.rollback()
                }
            }
        }
        val after = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        assertEquals(before, after)
    }

    @Test
    fun `a run refuses a source edit committed during validation`() = checkConcurrentChange { c, listId, _ ->
        c.prepareStatement("UPDATE lists SET name = 'changed', updated_at = now() WHERE id = ?").use {
            it.setInt(1, listId)
            it.executeUpdate()
        }
    }

    @Test
    fun `a run refuses archiving committed during validation`() = checkConcurrentChange { c, _, regId ->
        c.prepareStatement("UPDATE reguleringer SET archived_at = now(), updated_at = now() WHERE id = ?").use {
            it.setInt(1, regId)
            it.executeUpdate()
        }
    }

    @Test
    fun `a run refuses membership removal committed during validation`() = checkConcurrentChange { c, _, regId ->
        c.prepareStatement("UPDATE reguleringer SET updated_at = now() WHERE id = ?").use {
            it.setInt(1, regId)
            it.executeUpdate()
        }
        c.prepareStatement("DELETE FROM regulering_lister WHERE regulering_id = ?").use {
            it.setInt(1, regId)
            it.executeUpdate()
        }
    }

    // The API is the observable boundary. A second DB session holds an uncommitted edit
    // so validation must wait and recheck it, rather than trusting the old committed row.
    private fun checkConcurrentChange(change: (Connection, Int, Int) -> Unit) = testApplication {
        val dbConfig = testConfig.toMap()
        val applicationName = "run-validation-${UUID.randomUUID()}"
        val url = dbConfig.getValue("db.url")
        val separator = if ('?' in url) '&' else '?'
        val upstreamHits = AtomicInteger()
        environment {
            config = MapApplicationConfig(
                testConfig + listOf(
                    "db.url" to "$url${separator}ApplicationName=$applicationName",
                    "testRuns.enabled" to "1",
                    "komregBackend.local.url" to "http://komreg-test",
                ),
            )
        }
        application {
            dependencies.provide<HttpClient> {
                HttpClient(
                    MockEngine {
                        upstreamHits.incrementAndGet()
                        respond("ok", HttpStatusCode.OK)
                    },
                )
            }
            module()
        }
        val createdList = client.post("/api/lists") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"source","data":{}}""")
        }
        assertEquals(HttpStatusCode.Created, createdList.status)
        val listId = Json.parseToJsonElement(
            createdList.bodyAsText(),
        ).jsonObject.getValue("id").jsonPrimitive.content.toInt()
        val createdReg = client.post("/api/reguleringer") {
            contentType(ContentType.Application.Json)
            setBody("""{"navn":"Concurrent","dato":"2027-01-01","listIds":[$listId]}""")
        }
        assertEquals(HttpStatusCode.Created, createdReg.status)
        val regId = Json.parseToJsonElement(
            createdReg.bodyAsText(),
        ).jsonObject.getValue("id").jsonPrimitive.content.toInt()
        val reg = Json.parseToJsonElement(client.get("/api/reguleringer/$regId").bodyAsText()).jsonObject
        val list = Json.parseToJsonElement(client.get("/api/lists/$listId").bodyAsText()).jsonObject
        val body = """{
          "expectedKomregUrl":"http://komreg-test","expectedReguleringUpdatedAt":${reg.getValue("updatedAt")},
          "sources":[{"listId":$listId,"name":${list.getValue("name")},"updatedAt":${list.getValue("updatedAt")}}],
          "rader":[{"id":"t:1","type":"teig","kommunenummer":"3201","nyKommunenummer":"3203","teigid":"1"}]
        }"""
        withContext(Dispatchers.IO) {
            DriverManager.getConnection(
                url,
                dbConfig.getValue("db.user"),
                dbConfig.getValue("db.password"),
            ).use { editor ->
                editor.autoCommit = false
                try {
                    change(editor, listId, regId)
                    coroutineScope {
                        val request = async {
                            client.post("/api/reguleringer/$regId/testkjoringer") {
                                contentType(ContentType.Application.Json)
                                setBody(body)
                            }
                        }
                        // Release only once the request either waits on our row lock or
                        // incorrectly finishes without waiting. No scheduling sleeps.
                        withTimeout(10_000) {
                            while (!request.isCompleted) {
                                // Activity snapshots are cached within our editing transaction.
                                editor.createStatement().use { it.execute("SELECT pg_stat_clear_snapshot()") }
                                val waiting = editor.prepareStatement(
                                    "SELECT 1 FROM pg_stat_activity WHERE application_name = ? AND wait_event_type = 'Lock'",
                                ).use { ps ->
                                    ps.setString(1, applicationName)
                                    ps.executeQuery().use { it.next() }
                                }
                                if (waiting) break
                                delay(10)
                            }
                        }
                        editor.commit()
                        assertEquals(HttpStatusCode.Conflict, request.await().status)
                    }
                } finally {
                    editor.rollback()
                }
            }
        }
        assertEquals(0, upstreamHits.get())
        assertEquals("[]", client.get("/api/reguleringer/$regId/testkjoringer").bodyAsText())
    }
}
