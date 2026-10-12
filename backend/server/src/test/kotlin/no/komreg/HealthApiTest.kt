package no.komreg

import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

class HealthApiTest {
    @Test
    fun `liveness and readiness respond ok`() = testApplication {
        environment { config = MapApplicationConfig(testConfig) }
        application { module() }
        assertEquals(HttpStatusCode.OK, client.get("/health/live").status)
        // Readiness exercises real DB connectivity against the test Postgres.
        assertEquals(HttpStatusCode.OK, client.get("/health/ready").status)
    }
}
