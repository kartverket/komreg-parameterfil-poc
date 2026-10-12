package no.komreg

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.log
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route

// Split probes, k8s-style. Liveness = the process is up and serving HTTP — it must not
// check dependencies, or a Postgres outage makes the orchestrator restart pods that a
// restart can't fix. Readiness = safe to route traffic here, which does require the DB.
fun Route.healthRoutes(db: Database) {
    route("/health") {
        get("/live") {
            call.respondText("ok")
        }
        get("/ready") {
            // Only the probe itself is guarded, and deliberately broadly: anything that
            // stops the DB check means "not ready". Narrowing to SQLException lets the
            // rest escape to the StatusPages catch-all, which answers 500 — a probe
            // reads that as a bug, not as "don't route to me yet". Responding outside
            // the try keeps a failed write from being caught and answered twice.
            val ok = try {
                db.withConnection { c -> c.prepareStatement("SELECT 1").use { it.executeQuery() } }
                true
            } catch (e: Exception) {
                call.application.log.warn("readiness: database check failed", e)
                false
            }
            if (ok) {
                call.respondText("ok")
            } else {
                call.respondText("db unreachable", status = HttpStatusCode.ServiceUnavailable)
            }
        }
    }
}
