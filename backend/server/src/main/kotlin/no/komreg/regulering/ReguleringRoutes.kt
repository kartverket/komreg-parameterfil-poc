package no.komreg.regulering

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import no.komreg.Kode
import no.komreg.problem

/*
 * Builds komreg-backend's parameterfil from already resolved rows.
 *
 * Purely functional: no database, no state. Nothing is stored — the download is the
 * product, and the saved list (the WorkingState blob) is already what it traces back to.
 *
 * This slice only BUILDS. The handover itself — POST /reguleringer and GET /run/{regId}
 * against komreg-backend — lives in kjoring/, which owns the outbound HTTP. See
 * docs/adr/0003-send-til-komreg-backend.md. The download is unchanged.
 */
fun Route.reguleringRoutes() {
    route("/regulering") {
        post {
            val req = call.receive<GenererRequest>()

            // Metadata first: without a valid id/navn/dato the row errors are beside the point.
            val metafeil = validerMetadata(req)
            if (metafeil.isNotEmpty()) {
                return@post call.ugyldig(metafeil)
            }

            // The row validation collects every error and throws once, so the user gets
            // the whole list instead of one error per round.
            try {
                call.respond(genererFiler(req))
            } catch (e: UgyldigReguleringException) {
                call.ugyldig(e.feil)
            }
        }
    }
}

// Every error at once, each as its own line in `feil`; `detail` is the same list as one text
// for a client that only shows that.
private suspend fun ApplicationCall.ugyldig(feil: List<String>) =
    problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_REGULERING, feil.joinToString("\n"), feil)
