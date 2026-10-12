package no.komreg.regulering

import kotlinx.serialization.encodeToString

/*
 * Assembles the response: one combined file + one per kommunepar, each already serialized.
 *
 * The serialization happens HERE, not in the frontend, on purpose. That makes kotlinx — the
 * same library and the same settings komreg-backend itself uses — decide the exact bytes
 * that are downloaded and sent on. The frontend downloads the string as it is.
 */

private val DATO = Regex("""\d{4}-\d{2}-\d{2}""")
private val UTRYGGE_TEGN = Regex("""[^\p{L}\p{N}_-]+""")

/** A filename-safe variant of the regulering id. */
private fun filnavnbit(id: String): String =
    id.trim().replace(UTRYGGE_TEGN, "_").ifBlank { "regulering" }

private fun antallPerType(transformasjoner: List<TransformasjonDTO>): Map<String, Int> =
    transformasjoner.groupingBy {
        when (it) {
            is MatrikkelenhetTransformasjonDTO -> "matrikkelenhet"
            is TeigTransformasjonDTO -> "teig"
            is VegTransformasjonDTO -> "veg"
            is VegadresseTransformasjonDTO -> "vegadresse"
            is FylkeTransformasjonDTO -> "fylke"
            is KommuneTransformasjonDTO -> "kommune"
            is KretsTransformasjonDTO -> "krets"
        }
    }.eachCount()

private fun fil(
    key: String,
    filnavn: String,
    regulering: Regulering,
    fra: String? = null,
    til: String? = null,
): ReguleringFil = ReguleringFil(
    key = key,
    fra = fra,
    til = til,
    filnavn = filnavn,
    antall = antallPerType(regulering.endringer.flatMap { it.transformasjoner }),
    json = reguleringJson.encodeToString(regulering),
)

/** Metadata errors (id/navn/dato). The row errors come from [byggEndringer]. */
fun validerMetadata(req: GenererRequest): List<String> = buildList {
    if (req.id.isBlank()) add("Reguleringen mangler id")
    if (req.navn.isBlank()) add("Reguleringen mangler navn")
    if (!DATO.matches(req.dato)) {
        add("Dato «${req.dato}» må være på formen ÅÅÅÅ-MM-DD (backend parser den som LocalDate)")
    }
    if (req.rader.isEmpty()) add("Ingen rader å eksportere")
}

fun genererFiler(req: GenererRequest): GenererResponse {
    val parEndringer = byggEndringer(req.rader)
    val basis = filnavnbit(req.id)

    val samlet = Regulering(
        id = req.id,
        navn = req.navn,
        dato = req.dato,
        endringer = parEndringer.map { it.endring },
    )

    return GenererResponse(
        samlet = fil(key = "samlet", filnavn = "$basis-samlet.json", regulering = samlet),
        // Each kommunepar becomes a COMPLETE regulering of its own — the body of
        // POST /reguleringer, not a loose EndringDTO. Its own id, or it collides with the
        // combined one on the backend's primary key.
        perPar = parEndringer.map { (par, endring) ->
            fil(
                key = par.key,
                fra = par.fra,
                til = par.til,
                filnavn = "$basis-${par.key}.json",
                regulering = Regulering(
                    id = "${req.id}-${par.key}",
                    navn = endring.navn,
                    dato = req.dato,
                    endringer = listOf(endring),
                ),
            )
        },
    )
}
