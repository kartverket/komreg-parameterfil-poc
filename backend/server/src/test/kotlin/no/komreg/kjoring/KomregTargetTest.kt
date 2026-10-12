package no.komreg.kjoring

import io.ktor.server.config.MapApplicationConfig
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

// Pure config parsing — no server, no database. These are the messages someone reads at
// 08:30 when the app refuses to boot, so they are asserted rather than assumed.
class KomregTargetTest {
    private fun config(vararg pairs: Pair<String, String>) = MapApplicationConfig(pairs.toList())

    @Test
    fun `defaults to local with no token`() {
        val t = KomregTarget.fromConfig(config("komregBackend.local.url" to "http://localhost:8081"))
        assertEquals("local", t.navn)
        assertNull(t.scope)
        assertEquals(false, t.kreverToken)
    }

    @Test
    fun `dev builds the scope from the client id`() {
        val t = KomregTarget.fromConfig(
            config(
                "komregBackend.target" to "dev",
                "komregBackend.dev.url" to "https://komreg-dev/",
                "komregBackend.dev.clientId" to "abc-123",
            ),
        )
        assertEquals("dev", t.navn)
        // Trailing slash stripped, or every built URL gets a double one.
        assertEquals("https://komreg-dev", t.url)
        assertEquals("abc-123/.default", t.scope)
    }

    @Test
    fun `an unknown target refuses to boot and names the valid ones`() {
        val e = assertFailsWith<IllegalStateException> {
            KomregTarget.fromConfig(config("komregBackend.target" to "prod"))
        }
        assertContains(e.message.orEmpty(), "local")
        assertContains(e.message.orEmpty(), "dev")
    }

    @Test
    fun `a dev target without a client id refuses to boot and names the env var`() {
        // The outcome worth crashing over is the quiet one: booting "dev" and silently
        // talking to localhost, or to dev with no token and a mystery 401.
        val e = assertFailsWith<IllegalStateException> {
            KomregTarget.fromConfig(
                config("komregBackend.target" to "dev", "komregBackend.dev.url" to "https://komreg-dev"),
            )
        }
        assertContains(e.message.orEmpty(), "KOMREG_DEV_CLIENT_ID")
    }

    @Test
    fun `a target without a url refuses to boot`() {
        val e = assertFailsWith<IllegalStateException> {
            KomregTarget.fromConfig(config("komregBackend.target" to "local"))
        }
        assertContains(e.message.orEmpty(), "KOMREG_LOCAL_URL")
    }
}
