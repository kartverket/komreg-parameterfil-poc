package no.komreg.reguleringer

import io.ktor.http.ContentDisposition
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingCall
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import java.sql.SQLException
import java.util.UUID
import no.komreg.Kode
import no.komreg.kjoring.KomregClient
import no.komreg.problem

private val BASE_ID = Regex("^[A-Za-z0-9_-]{1,48}$")
private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

// The base id is not something a person types — it is only the prefix of the externalId
// that goes to komreg-backend (`<base-id>-t-<suffix>`), where a single-use suffix already
// makes every kjøring unique. So we mint one from the name: readable in komreg-backend's
// list of kjøringer, and a short random tail keeps base_id's UNIQUE intact when two
// reguleringer share a name. The result always fits BASE_ID (at most 40 + 1 + 6 = 47 chars).
private fun genererBaseId(navn: String): String {
    val slug = navn.lowercase()
        .replace("æ", "ae").replace("ø", "oe").replace("å", "aa")
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .take(40)
        .trim('-')
    val hale = UUID.randomUUID().toString().take(6)
    return if (slug.isEmpty()) "reg-$hale" else "$slug-$hale"
}

// Fill in a minted base id when the client did not send one. The name has already been
// validated as non-empty before this is called.
private fun SaveReguleringRequest.medBaseId(): SaveReguleringRequest =
    copy(baseId = baseId?.takeUnless(String::isBlank) ?: genererBaseId(navn))

// Both POST and PUT can break base_id's UNIQUE or list_id's foreign key. The database is
// the one that knows, so we let it answer instead of asking first — a pre-check would be
// another TOCTOU window and one more round trip.
private const val INTEGRITETSFEIL =
    "Base-id finnes allerede, eller en grensejustering finnes ikke."

fun Route.reguleringerRoutes(
    repo: ReguleringerRepository,
    komreg: KomregClient,
    testRunsEnabled: Boolean,
) {
    route("/reguleringer") {
        get {
            call.respond(repo.all(call.request.queryParameters["arkiverte"] == "1"))
        }

        post {
            val body = call.receive<SaveReguleringRequest>()
            validationError(body)?.let { return@post call.badRequest(it) }
            try {
                call.respond(HttpStatusCode.Created, ReguleringIdResponse(repo.create(body.medBaseId())))
            } catch (e: SQLException) {
                // Only integrity violations mean invalid input. Timeouts and connectivity
                // failures must reach StatusPages rather than masquerading as a conflict.
                if (e.sqlState?.startsWith("23") != true) throw e
                call.problem(HttpStatusCode.Conflict, Kode.INTEGRITET, INTEGRITETSFEIL)
            }
        }

        route("/{id}") {
            get {
                val id =
                    call.reguleringId() ?: return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                repo.find(id)?.let { call.respond(it) } ?: call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
            }

            put {
                val id =
                    call.reguleringId() ?: return@put call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                val body = call.receive<SaveReguleringRequest>()
                validationError(body)?.let { return@put call.badRequest(it) }
                try {
                    when (repo.update(id, body.medBaseId())) {
                        null -> call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                        false -> call.conflict(
                            "Reguleringen er endret eller arkivert. Last siden på nytt.",
                        )
                        true -> call.respond(HttpStatusCode.OK)
                    }
                } catch (e: SQLException) {
                    if (e.sqlState?.startsWith("23") != true) throw e
                    call.problem(HttpStatusCode.Conflict, Kode.INTEGRITET, INTEGRITETSFEIL)
                }
            }

            post("/arkiver") {
                val id =
                    call.reguleringId() ?: return@post call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                if (repo.setArchived(
                        id,
                        true,
                    )
                ) {
                    call.respond(HttpStatusCode.OK)
                } else {
                    call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                }
            }

            post("/gjenopprett") {
                val id =
                    call.reguleringId() ?: return@post call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                if (repo.setArchived(
                        id,
                        false,
                    )
                ) {
                    call.respond(HttpStatusCode.OK)
                } else {
                    call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                }
            }

            get("/testkjoringer") {
                val id =
                    call.reguleringId() ?: return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                if (repo.find(id) == null) {
                    call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                } else {
                    call.respond(repo.runs(id))
                }
            }

            // The run itself is in kjorTestkjoring — here there is only the gate (are test
            // runs turned on in this environment?) and the mapping from outcome to status.
            post("/testkjoringer") {
                if (!testRunsEnabled) {
                    return@post call.problem(
                        HttpStatusCode.Forbidden,
                        Kode.TESTKJORING_IKKE_AKTIVERT,
                        "Testkjøring er ikke aktivert i dette miljøet.",
                    )
                }
                val id =
                    call.reguleringId() ?: return@post call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                val body = call.receive<StartTestRunRequest>()
                when (val utfall = kjorTestkjoring(repo, komreg, id, body)) {
                    is TestkjoringUtfall.Ugyldig -> call.badRequest(utfall.melding)
                    TestkjoringUtfall.FinnesIkke -> call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                    is TestkjoringUtfall.Konflikt -> call.conflict(utfall.melding)
                    // 200 also when the send or the start was rejected: the attempt is
                    // journalled, and the row is the answer to how it went.
                    is TestkjoringUtfall.Utfort -> call.respond(HttpStatusCode.OK, utfall.run)
                }
            }

            // Start a kjøring that was sent without being started (`start: false` above).
            // Same gate and same outcome mapping as send-and-start; the order is in the service.
            post("/testkjoringer/{runId}/start") {
                if (!testRunsEnabled) {
                    return@post call.problem(
                        HttpStatusCode.Forbidden,
                        Kode.TESTKJORING_IKKE_AKTIVERT,
                        "Testkjøring er ikke aktivert i dette miljøet.",
                    )
                }
                val id =
                    call.reguleringId() ?: return@post call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                val runId = call.pathParameters["runId"]?.toLongOrNull()
                    ?: return@post call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                val body = call.receive<StartSentRunRequest>()
                when (val utfall = startSendtKjoring(repo, komreg, id, runId, body.expectedKomregUrl)) {
                    is TestkjoringUtfall.Ugyldig -> call.badRequest(utfall.melding)
                    TestkjoringUtfall.FinnesIkke -> call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                    is TestkjoringUtfall.Konflikt -> call.conflict(utfall.melding)
                    is TestkjoringUtfall.Utfort -> call.respond(HttpStatusCode.OK, utfall.run)
                }
            }

            get("/testkjoringer/{runId}/payload") {
                val id =
                    call.reguleringId() ?: return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                val runId = call.pathParameters["runId"]?.toLongOrNull()
                    ?: return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
                val (externalId, payload) = repo.payload(id, runId)
                    ?: return@get call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)
                // The filename is the kjøring's single-use id, so a downloaded file can be
                // traced back to the row that journalled it.
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    ContentDisposition.Attachment
                        .withParameter(ContentDisposition.Parameters.FileName, "$externalId.json")
                        .toString(),
                )
                call.respondText(payload, ContentType.Application.Json)
            }
        }
    }
}

// Handlers read path variables via pathParameters, never via the merged `parameters`,
// where a query key shadows a path variable of the same name. RoutingCall and not
// ApplicationCall: only the routing call HAS path variables.
private fun RoutingCall.reguleringId(): Int? = pathParameters["id"]?.toIntOrNull()

private suspend fun ApplicationCall.badRequest(melding: String) =
    problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL, melding)

// Every 409 from the reguleringer routes that is not an integrity violation means the same
// thing to the client: what you are looking at is no longer what is saved, load it again.
private suspend fun ApplicationCall.conflict(melding: String) =
    problem(HttpStatusCode.Conflict, Kode.ENDRET_SIDEN_LASTING, melding)

private fun validationError(body: SaveReguleringRequest): String? = when {
    // A base id that is sent must still be valid; a missing one (null) is minted in medBaseId.
    body.baseId != null && !BASE_ID.matches(body.baseId) ->
        "Base-id må være 1–48 tegn og bare inneholde bokstaver, tall, _ eller -."
    body.navn.isBlank() -> "Navn kan ikke være tomt."
    !DATE.matches(body.dato) -> "Dato må være på formen ÅÅÅÅ-MM-DD."
    else -> null
}
