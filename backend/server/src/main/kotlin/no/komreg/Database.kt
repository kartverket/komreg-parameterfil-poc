package no.komreg

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.config.ApplicationConfig
import java.sql.Connection
import javax.sql.DataSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.flywaydb.core.Flyway
import org.postgresql.ds.PGSimpleDataSource

/**
 * Run [block] on [this] connection as one transaction: commit on success, roll back on
 * any throw, and restore the connection's previous autoCommit either way (it goes back
 * to the pool afterwards, so leaving it off would poison the next borrower).
 *
 * Lives here rather than in the slice that first needed it: a transaction is a Database
 * concern, and next to [Database.withConnection] is where the next slice will look for
 * it instead of writing a second copy.
 *
 * Rolls back on Throwable, not Exception — a cancellation mid-transaction must not leave
 * the work half-applied and then commit it on the way out.
 */
fun <T> Connection.transaction(block: () -> T): T {
    val previous = autoCommit
    autoCommit = false
    return try {
        block().also { commit() }
    } catch (e: Throwable) {
        rollback()
        throw e
    } finally {
        autoCommit = previous
    }
}

class Database(private val ds: DataSource, private val migrationDs: DataSource = ds) : AutoCloseable {
    // The schema is owned by Flyway (src/main/resources/db/migration/V*.sql), applied at
    // boot. Flyway locks its history table, so replicas starting concurrently serialize
    // instead of racing on DDL.
    fun init() {
        Flyway.configure()
            .dataSource(migrationDs)
            .baselineOnMigrate(true)
            .load()
            .migrate()
    }

    // JDBC is blocking, and Ktor handlers run on a small shared thread pool — a slow
    // query there would stall unrelated requests. Every DB access goes through this,
    // which shifts the blocking work to the IO dispatcher and closes the connection.
    suspend fun <T> withConnection(block: (Connection) -> T): T =
        withContext(Dispatchers.IO) { ds.connection.use(block) }

    // AutoCloseable so the DI container closes the pool on shutdown — a rolling restart
    // returns connections to Postgres cleanly instead of dropping them.
    override fun close() {
        (ds as? AutoCloseable)?.close()
    }

    companion object {
        // Reads db.{url,user,password} from config (env-substituted in application.conf).
        //
        // Missing config is a startup error, not a fallback: a typo'd Secret key or a
        // dropped envFrom would otherwise silently point a deployed pod at
        // localhost/komreg/komreg — a confusing crash at best, and the *wrong database*
        // on any host that happens to run a local Postgres. Set DEV_DB=1 to opt into the
        // local defaults when running `./gradlew run` by hand (compose and the tests both
        // pass db.* explicitly, so neither needs it).
        fun fromConfig(config: ApplicationConfig): Database {
            val devDb = config.propertyOrNull("dev.db")?.getString() == "1"
            fun value(key: String, devDefault: String): String {
                config.propertyOrNull("db.$key")?.getString()?.let { return it }
                check(devDb) {
                    "db.$key is not set (expected env DB_${key.uppercase()}); " +
                        "set DEV_DB=1 to use the local dev defaults"
                }
                return devDefault
            }

            val url = value("url", "jdbc:postgresql://localhost:5432/komreg")
            val user = value("user", "komreg")
            val password = value("password", "komreg")
            fun seconds(key: String, default: Int): Int {
                val raw = config.propertyOrNull("db.$key")?.getString() ?: default.toString()
                return requireNotNull(raw.toIntOrNull()?.takeIf { it > 0 }) {
                    "db.$key must be a positive integer (seconds)"
                }
            }

            fun dataSource(prefix: String, statement: Int, lock: Int, idle: Int, socket: Int): PGSimpleDataSource =
                PGSimpleDataSource().apply {
                    setURL(url)
                    setUser(user)
                    setPassword(password)
                    options = "-c statement_timeout=${seconds("$prefix.statementTimeoutSeconds", statement)}s " +
                        "-c lock_timeout=${seconds("$prefix.lockTimeoutSeconds", lock)}s " +
                        "-c idle_in_transaction_session_timeout=${seconds(
                            "$prefix.idleTransactionTimeoutSeconds",
                            idle,
                        )}s"
                    socketTimeout = seconds("$prefix.socketTimeoutSeconds", socket)
                }

            // Set session defaults at connection creation, rather than changing and resetting
            // pooled connections around Flyway. Migration connections are unpooled and short-lived.
            val runtimeDs = dataSource("runtime", statement = 10, lock = 3, idle = 30, socket = 30)
            val migrationDs = dataSource("migration", statement = 120, lock = 10, idle = 180, socket = 180)
            val cfg = HikariConfig().apply {
                dataSource = runtimeDs
                maximumPoolSize = 5
            }
            return Database(HikariDataSource(cfg), migrationDs)
        }
    }
}
