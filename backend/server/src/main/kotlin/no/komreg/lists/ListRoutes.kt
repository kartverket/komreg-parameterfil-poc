package no.komreg.lists

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.install
import io.ktor.server.plugins.bodylimit.RequestBodyLimit
import io.ktor.server.plugins.requestvalidation.RequestValidation
import io.ktor.server.plugins.requestvalidation.ValidationResult
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import no.komreg.Kode
import no.komreg.problem
import no.komreg.reguleringer.ReguleringerRepository

// A blob is one working selection (geometries included) — generous, but bounded so a
// runaway client can't stuff arbitrary amounts of data into the table. Enforced by
// RequestBodyLimit below, which counts while the body streams in — checking the
// Content-Length header alone would miss chunked requests, which carry none.
private const val MAX_LIST_BYTES = 32L * 1024 * 1024

fun Route.listRoutes(repo: ListRepository, reguleringer: ReguleringerRepository) {
    route("/lists") {
        // Over-limit receives throw PayloadTooLargeException → 413 via StatusPages.
        install(RequestBodyLimit) { bodyLimit { MAX_LIST_BYTES } }
        // Body rules live next to the routes they guard; handlers just receive(). A
        // failed rule throws RequestValidationException → 400 + reason via StatusPages.
        install(RequestValidation) {
            validate<SaveRequest> { body -> validName(body.name) }
            validate<UpdateRequest> { body -> validName(body.name) }
        }

        get {
            call.respond(repo.all())
        }

        post {
            val body = call.receive<SaveRequest>()
            call.respond(HttpStatusCode.Created, repo.create(body.name, body.data))
        }

        get("/{id}") {
            val id = call.pathParameters["id"]?.toIntOrNull()
                ?: return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            val found = repo.find(id)
            if (found == null) call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE) else call.respond(found)
        }

        put("/{id}") {
            val id = call.pathParameters["id"]?.toIntOrNull()
                ?: return@put call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            val body = call.receive<UpdateRequest>()
            val updatedAt = repo.update(id, body.name, body.data, body.expectedUpdatedAt)
            when {
                updatedAt != null -> call.respond(UpdatedResponse(updatedAt))
                repo.exists(id) -> call.problem(
                    HttpStatusCode.Conflict,
                    Kode.ENDRET_SIDEN_LASTING,
                    "Grensejusteringen er endret et annet sted. Last den på nytt.",
                )
                else -> call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
            }
        }

        delete("/{id}") {
            val id = call.pathParameters["id"]?.toIntOrNull()
                ?: return@delete call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            // force=1 is the caller saying yes to the 409 below: drop the memberships too.
            if (call.request.queryParameters["force"] == "1") {
                val deleted = reguleringer.slettListeMedMedlemskap(id)
                return@delete if (deleted) {
                    call.respond(
                        HttpStatusCode.OK,
                    )
                } else {
                    call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                }
            }
            val blockers = reguleringer.blockersForList(id)
            if (blockers.isNotEmpty()) {
                return@delete call.problem(
                    HttpStatusCode.Conflict,
                    Kode.I_BRUK,
                    "Grensejusteringen brukes av: ${blockers.joinToString(", ")}",
                )
            }
            val deleted = repo.delete(id)
            if (deleted) call.respond(HttpStatusCode.OK) else call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
        }
    }
}

private fun validName(name: String): ValidationResult =
    if (name.isBlank()) ValidationResult.Invalid("name must not be blank") else ValidationResult.Valid
