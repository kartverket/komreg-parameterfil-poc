package no.komreg

import io.ktor.server.config.MapApplicationConfig
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.coroutines.runBlocking

class DatabaseTest {
    @Test
    fun `runtime sessions have bounded statement lock idle and socket timeouts`() = runBlocking {
        Database.fromConfig(MapApplicationConfig(testConfig)).use { db ->
            db.withConnection { connection ->
                assertEquals(10, connection.timeoutSeconds("statement_timeout"))
                assertEquals(3, connection.timeoutSeconds("lock_timeout"))
                assertEquals(30, connection.timeoutSeconds("idle_in_transaction_session_timeout"))
                assertEquals(30_000, connection.networkTimeout)
            }
        }
    }

    @Test
    fun `slow statements are cancelled and rolled back without poisoning the next borrower`() = runBlocking {
        val config = MapApplicationConfig(testConfig + ("db.runtime.statementTimeoutSeconds" to "1"))
        Database.fromConfig(config).use { db ->
            db.withConnection { connection ->
                val error = assertFailsWith<SQLException> {
                    connection.transaction {
                        connection.createStatement().use { it.execute("SELECT pg_sleep(5)") }
                    }
                }
                assertEquals("57014", error.sqlState)
                assertEquals(true, connection.autoCommit)
                connection.createStatement().use { statement ->
                    statement.executeQuery("SELECT 1").use { rows ->
                        rows.next()
                        assertEquals(1, rows.getInt(1))
                    }
                }
            }
            db.withConnection { assertEquals(1, it.timeoutSeconds("statement_timeout")) }
        }
    }

    @Test
    fun `lock waits are cancelled before the longer statement timeout`() = runBlocking {
        val config = MapApplicationConfig(testConfig + ("db.runtime.lockTimeoutSeconds" to "1"))
        Database.fromConfig(config).use { db ->
            db.withConnection { holder ->
                holder.createStatement().use { it.execute("SELECT pg_advisory_lock(984321)") }
                try {
                    runBlocking {
                        db.withConnection { waiter ->
                            val error = assertFailsWith<SQLException> {
                                waiter.transaction {
                                    waiter.createStatement().use { statement ->
                                        // Bound the regression test even if the session lock limit is missing.
                                        statement.queryTimeout = 5
                                        statement.execute("SELECT pg_advisory_xact_lock(984321)")
                                    }
                                }
                            }
                            assertEquals("55P03", error.sqlState)
                        }
                    }
                } finally {
                    holder.createStatement().use { it.execute("SELECT pg_advisory_unlock(984321)") }
                }
            }
        }
    }

    @Test
    fun `fresh and repeated migrations leave runtime session limits intact`() = runBlocking {
        val values = testConfig.toMap()
        val schema = "timeout_test_${UUID.randomUUID().toString().replace("-", "")}"
        DriverManager.getConnection(
            values.getValue("db.url"),
            values.getValue("db.user"),
            values.getValue("db.password"),
        )
            .use { admin ->
                admin.createStatement().use { it.execute("CREATE SCHEMA $schema") }
                try {
                    val url = values.getValue("db.url")
                    val scopedUrl = "$url${if ('?' in url) '&' else '?'}currentSchema=$schema"
                    val config = MapApplicationConfig(
                        testConfig + listOf(
                            "db.url" to scopedUrl,
                            "db.runtime.statementTimeoutSeconds" to "1",
                            "db.runtime.lockTimeoutSeconds" to "1",
                        ),
                    )
                    Database.fromConfig(config).use { db ->
                        db.init()
                        db.init()
                        db.withConnection { connection ->
                            assertEquals(1, connection.timeoutSeconds("statement_timeout"))
                            assertEquals(1, connection.timeoutSeconds("lock_timeout"))
                            connection.createStatement().use { statement ->
                                statement.executeQuery("SELECT count(*) FROM lists").use { rows ->
                                    rows.next()
                                    assertEquals(0, rows.getInt(1))
                                }
                            }
                        }
                    }
                } finally {
                    admin.createStatement().use { it.execute("DROP SCHEMA $schema CASCADE") }
                }
            }
    }

    @Test
    fun `invalid timeout configuration fails before opening the pool`() {
        for (value in listOf("0", "-1", "not-a-number")) {
            assertFailsWith<IllegalArgumentException> {
                Database.fromConfig(MapApplicationConfig(testConfig + ("db.runtime.statementTimeoutSeconds" to value)))
            }
        }
    }

    private fun Connection.timeoutSeconds(setting: String): Int = createStatement().use { statement ->
        statement.executeQuery(
            "SELECT extract(epoch FROM current_setting('$setting')::interval)::integer",
        ).use { rows ->
            rows.next()
            rows.getInt(1)
        }
    }
}
