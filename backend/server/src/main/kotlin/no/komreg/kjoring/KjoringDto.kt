package no.komreg.kjoring

import kotlinx.serialization.Serializable

/*
 * Our own API towards the frontend for the read routes in kjoring/. The outcome of a
 * send/start is in KomregResult (KomregClient.kt), and is journalled by the reguleringer/
 * slice.
 */

/**
 * One regulering in komreg-backend, reduced to what the overview needs.
 *
 * GET /reguleringer over there returns every regulering in full, and a large kjøring is
 * tens of thousands of transformasjoner. We pick a few numbers and discard the rest.
 *
 * [antallEndringer] counts EndringDTOs, and there is one per kommunepar (ReguleringBuilder),
 * so that number is 1–2 for a grensejustering however large the job is. The size is in
 * [antallTransformasjoner], and what it consists of in [transformasjonerPerType] — those
 * are the numbers you actually compare a kjøring against what you expected.
 */
@Serializable
data class ReguleringSammendrag(
    val id: String,
    val navn: String,
    val dato: String,
    val antallEndringer: Int,
    val antallTransformasjoner: Int,
    /** type ("teig", "matrikkelenhet", …) -> count, in the order the payload has them. */
    val transformasjonerPerType: Map<String, Int>,
)

/** GET /is-running, which is a bare JSON boolean, wrapped in something with a name. */
@Serializable
data class StatusResponse(val kjorer: Boolean)

/**
 * Which komreg-backend we point at, and whether we have a token for it.
 *
 * The frontend shows this as a badge on every page that can trigger something over there.
 * It is cheap, and it is what keeps someone from starting a DEV kjøring believing they are
 * local — `TOGGLE_SINK_OFF` is set on the pod, not by us, so a DEV kjøring can write to
 * Matrikkelen.
 */
@Serializable
data class Miljo(
    val navn: String,
    val url: String,
    val kreverToken: Boolean,
    val tokenOk: Boolean,
    val tokenFeil: String? = null,
)
