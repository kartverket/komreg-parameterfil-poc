package no.komreg

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.path
import io.ktor.server.response.respondText
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The one error body this API sends: `application/problem+json` (RFC 9457).
 *
 * [detail] is text for the user, in Norwegian, and the frontend shows it unchanged. [kode] is
 * what the frontend branches on — never the text, and never the status alone: one status
 * can have several causes ("changed elsewhere" and "in use" are both 409).
 *
 * [feil] is filled only when a request is rejected for several reasons at once, so the
 * user gets the whole list instead of one error per round.
 */
@Serializable
data class Problem(
    val type: String = "about:blank",
    val title: String,
    val status: Int,
    val detail: String? = null,
    val instance: String,
    val kode: Kode,
    val feil: List<ProblemFeil> = emptyList(),
)

@Serializable
data class ProblemFeil(val melding: String)

/**
 * Why a request failed, as a fixed value. The list is part of the API: adding one is fine,
 * renaming or removing one breaks the frontend's branching.
 */
@Serializable
enum class Kode {
    @SerialName("ugyldig-foresporsel")
    UGYLDIG_FORESPORSEL,

    @SerialName("ugyldig-regulering")
    UGYLDIG_REGULERING,

    @SerialName("finnes-ikke")
    FINNES_IKKE,

    @SerialName("endret-siden-lasting")
    ENDRET_SIDEN_LASTING,

    @SerialName("i-bruk")
    I_BRUK,

    @SerialName("integritet")
    INTEGRITET,

    @SerialName("testkjoring-ikke-aktivert")
    TESTKJORING_IKKE_AKTIVERT,

    @SerialName("for-stor")
    FOR_STOR,

    @SerialName("medietype-ikke-stottet")
    MEDIETYPE_IKKE_STOTTET,

    @SerialName("oppstroms-utilgjengelig")
    OPPSTROMS_UTILGJENGELIG,

    @SerialName("intern-feil")
    INTERN_FEIL,
}

// Not the app's DefaultJson: defaults must be written (`type`, an empty `feil`) and an
// absent `detail` left out rather than sent as null.
private val problemJson = Json {
    encodeDefaults = true
    explicitNulls = false
}

private val PROBLEM_JSON = ContentType("application", "problem+json")

/**
 * Answer with a [Problem]. `instance` is the path without the query string: the `/geo`
 * queries carry kommune-, gårds- and bruksnummer, and those have no place in an error body.
 */
suspend fun ApplicationCall.problem(
    status: HttpStatusCode,
    kode: Kode,
    detail: String? = null,
    feil: List<String> = emptyList(),
) = respondText(
    problemJson.encodeToString(
        Problem(
            title = status.description,
            status = status.value,
            detail = detail,
            instance = request.path(),
            kode = kode,
            feil = feil.map(::ProblemFeil),
        ),
    ),
    PROBLEM_JSON,
    status,
)
