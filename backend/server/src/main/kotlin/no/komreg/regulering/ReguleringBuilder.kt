package no.komreg.regulering

/*
 * RadDTO -> komreg Regulering.
 *
 * The transformasjon patterns follow the payloads that were actually run in prod. The
 * input is rows the frontend has already resolved.
 *
 * Do not "tidy" the transformasjon patterns — least of all the matrikkelenhet asymmetry;
 * see the comment in byggMatrikkelenhet.
 *
 * Format reference: `regulering-format.md` in kartverket/smia-docs
 */

/** A source/target pair of kommuner. One of these = one EndringDTO. */
data class Kommunepar(val fra: String, val til: String) {
    val fraFylke: String get() = fylkeAv(fra)
    val tilFylke: String get() = fylkeAv(til)
    val fraLøpenummer: String get() = løpenummerAv(fra)
    val tilLøpenummer: String get() = løpenummerAv(til)
    val key: String get() = "$fra-$til"
}

/**
 * A kommunenummer is fylkesnummer (2 digits) + kommuneløpenummer (2 digits): 3209 = 32 + 09.
 * The same split as komreg-backend's genererParameter/TransformasjonBuilder#splitKommunenummer.
 */
private fun fylkeAv(kommunenummer: String): String = kommunenummer.dropLast(2)

private fun løpenummerAv(kommunenummer: String): String = kommunenummer.takeLast(2)

/** One endring per kommunepar, in a stable order. */
data class ParEndring(val par: Kommunepar, val endring: EndringDTO)

/** Every validation error, collected. See the comment above [validerRader]. */
class UgyldigReguleringException(val feil: List<String>) : IllegalArgumentException(
    buildString {
        append("Radene kan ikke bli en gyldig regulering (${feil.size} feil):\n")
        feil.forEach { append("  - ").append(it).append('\n') }
    },
)

/** Groups the rows on (kommunenummer, nyKommunenummer) and builds one EndringDTO per pair. */
fun byggEndringer(rader: List<RadDTO>): List<ParEndring> {
    require(rader.isNotEmpty()) { "Ingen rader å bygge regulering av." }
    validerRader(rader)

    // groupBy has LinkedHashMap semantics: the pairs come in the order they first appear,
    // so the output is stable between runs.
    return rader
        .groupBy { Kommunepar(it.kommunenummer, it.nyKommunenummer) }
        .map { (par, parRader) ->
            ParEndring(
                par = par,
                endring = EndringDTO(
                    id = par.key,
                    navn = "Grensejustering ${par.fra} → ${par.til}",
                    type = "kommune",
                    // A pure grensejustering (K3) creates nothing and merges nothing; both
                    // kommuner remain. The lists are always empty, but EndringDTO has no
                    // defaults in the backend, so they MUST be present.
                    utgåendeFylker = emptyList(),
                    utgåendeKommuner = emptyList(),
                    nyeFylker = emptyList(),
                    nyeKommuner = emptyList(),
                    transformasjoner = byggTransformasjoner(par, parRader),
                ),
            )
        }
}

private fun byggTransformasjoner(par: Kommunepar, rader: List<RadDTO>): List<TransformasjonDTO> {
    val transformasjoner = mutableListOf<TransformasjonDTO>()

    // The order matrikkelenhet -> teig -> veg -> vegadresse mirrors the payload that ran in
    // prod. The backend does not care, but diffing against the reference files does.
    rader.filter { it.type == "matrikkelenhet" }.forEach { r ->
        transformasjoner += byggMatrikkelenhet(par, r)
    }

    rader.filter { it.type == "teig" }.forEach { r ->
        // The teig keeps its teigId (fra == til); only which kommune it belongs to changes.
        transformasjoner += TeigTransformasjonDTO(
            fylkesnummer = FraTilDTO(par.fraFylke, par.tilFylke),
            kommuneløpenummer = FraTilDTO(par.fraLøpenummer, par.tilLøpenummer),
            teigId = FraTilDTO(r.teigid, r.teigid),
        )
    }

    rader.filter { it.type == "veg" }.forEach { r ->
        // Veg uses FraEnTilMange (til is a list) — here one new adressekode in the target kommune.
        transformasjoner += VegTransformasjonDTO(
            fylkesnummer = FraEnTilMangeDTO(par.fraFylke, listOf(par.tilFylke)),
            kommuneløpenummer = FraEnTilMangeDTO(par.fraLøpenummer, listOf(par.tilLøpenummer)),
            adressekode = FraEnTilMangeDTO(
                r.adressekode,
                listOf(r.nyAdressekode.ifBlank { r.adressekode }),
            ),
        )
    }

    rader.filter { it.type == "vegadresse" }.forEach { r ->
        transformasjoner += VegadresseTransformasjonDTO(
            fylkesnummer = FraTilDTO(par.fraFylke, par.tilFylke),
            kommuneløpenummer = FraTilDTO(par.fraLøpenummer, par.tilLøpenummer),
            adressekode = FraTilDTO(r.adressekode, r.nyAdressekode.ifBlank { r.adressekode }),
            adressenummer = FraTilDTO(
                r.adressenummer,
                r.nyAdressenummer.ifBlank { r.adressenummer },
            ),
        )
    }

    return transformasjoner
}

/**
 * Matrikkelenhet has two entirely different shapes, and the row tells them apart by whether
 * bruksnummer is filled in. See regulering-format.md §9 ("Granularitet (hele gnr vs. enkelt-bnr)").
 */
private fun byggMatrikkelenhet(par: Kommunepar, r: RadDTO): MatrikkelenhetTransformasjonDTO {
    val nyttGnr = r.nyGardsnummer.ifBlank { r.gardsnummer }

    if (r.bruksnummer.isBlank()) {
        // THE WHOLE GÅRD MOVES: the target sits in the outer .til, and the bruksnummer map is
        // left out entirely. Every bnr under the gård then inherits the new kommune and gnr.
        return MatrikkelenhetTransformasjonDTO(
            fylkesnummer = FraTilDTO(par.fraFylke, par.tilFylke),
            kommuneløpenummer = FraTilDTO(par.fraLøpenummer, par.tilLøpenummer),
            gårdsnummer = FraTilDTO(r.gardsnummer, nyttGnr),
            bruksnummer = null,
        )
    }

    // MOVING ONE SPECIFIC BRUKSNUMMER. Note the asymmetry — it is deliberate:
    //   - The WHOLE outer object is HELD (fra == til for fylke, kommune and gnr): the gård
    //     itself stays in the source kommune, and only the listed bruksnummer move.
    //   - The TARGET (new fylke/kommune/gnr/bnr) sits in the nested bruksnummer object.
    // The backend (mapMatrikkelenhetendring) skips the outer gårdsnummer-serie rule only
    // when the outer fra and til are exactly equal. If one component differs — the fylke
    // alone is enough — every bnr row emits a rule on (fra-fylke, fra-kommune, fra-gnr).
    // Several rows on the same gnr then give identical, equally specific rules, and the
    // backend throws "More than one match" in IdentTransformer for any other bnr in the
    // gård. The outer fylke used to be fra -> til; that worked inside one fylke and sent
    // the gård to (til-fylke, fra-kommune) across fylker: 5060-90 became 1860-90.
    val nyttBnr = r.nyBruksnummer.ifBlank { r.bruksnummer }
    return MatrikkelenhetTransformasjonDTO(
        fylkesnummer = FraTilDTO(par.fraFylke, par.fraFylke),
        kommuneløpenummer = FraTilDTO(par.fraLøpenummer, par.fraLøpenummer),
        gårdsnummer = FraTilDTO(r.gardsnummer, r.gardsnummer),
        bruksnummer = mapOf(
            r.bruksnummer to TilGrunneiendomDTO(
                // Always explicit: left out, it would inherit the outer .til, now the source fylke.
                fylkesnummer = par.tilFylke.toLong(),
                kommunelopenummer = par.tilLøpenummer.toByte(),
                gardsnummer = nyttGnr.toInt(),
                bruksnummer = nyttBnr.toShort(),
            ),
        ),
    )
}

// --- Validation ---------------------------------------------------------------------
//
// We collect EVERY error and throw once. Failing on the first row forces one
// fix-and-rerun round per error, and the user fixes them in the komreg-liste — so they
// want the whole list.
//
// Note that this is the only structural check there is: komreg-backend's
// ReguleringValidator has rules for splitting a fylke, a kommune and a veg, but NONE for a
// pure grensejustering. A K3 regulering passes there unchecked.

private fun validerRader(rader: List<RadDTO>) {
    val feil = mutableListOf<String>()

    rader.forEach { r ->
        val hvor = "${r.id} (type=${r.type})"
        if (r.type !in GYLDIGE_TYPER) feil += "$hvor: ukjent type «${r.type}»"

        when {
            r.kommunenummer.isBlank() -> feil += "$hvor: mangler kommunenummer"
            !erKommunenummer(r.kommunenummer) ->
                feil += "$hvor: kommunenummer «${r.kommunenummer}» må være 4 siffer"
        }
        when {
            r.nyKommunenummer.isBlank() ->
                feil += "$hvor: mangler ny kommune — fyll ut «Flytt til kommune» i komreg-lista"
            !erKommunenummer(r.nyKommunenummer) ->
                feil += "$hvor: ny kommune «${r.nyKommunenummer}» må være 4 siffer"
            r.nyKommunenummer == r.kommunenummer ->
                feil += "$hvor: ny kommune er lik dagens (${r.kommunenummer}) — ingen flytting"
        }

        // The fields each type actually needs to become a transformasjon.
        val påkrevd = when (r.type) {
            "matrikkelenhet" -> listOf("gardsnummer" to r.gardsnummer)
            "teig" -> listOf("teigid" to r.teigid)
            "veg" -> listOf("adressekode" to r.adressekode)
            "vegadresse" -> listOf(
                "adressekode" to r.adressekode,
                "adressenummer" to r.adressenummer,
            )
            else -> emptyList()
        }
        påkrevd.filter { (_, verdi) -> verdi.isBlank() }
            .forEach { (navn, _) -> feil += "$hvor: mangler $navn" }

        feil += tallfeil(hvor, r)
    }

    feil += finnDuplikater(rader, "kilde", ::kildeIdent)
    feil += finnDuplikater(rader, "mål", ::målIdent)
    feil += finnMotstridendeGnr(rader)

    if (feil.isNotEmpty()) throw UgyldigReguleringException(feil)
}

private val GYLDIGE_TYPER = setOf("matrikkelenhet", "teig", "veg", "vegadresse")

private fun erKommunenummer(v: String): Boolean = v.length == 4 && v.all { it.isDigit() }

/**
 * The values that end up as NUMBERS in the payload must actually fit the backend's types.
 * The backend only parses them at GET /run — an overflow there is a 500 in the middle of
 * a kjøring, not an error message when the parameterfil is built.
 */
private fun tallfeil(hvor: String, r: RadDTO): List<String> {
    if (r.type != "matrikkelenhet" || r.bruksnummer.isBlank()) return emptyList()
    val feil = mutableListOf<String>()
    val nyttGnr = r.nyGardsnummer.ifBlank { r.gardsnummer }
    val nyttBnr = r.nyBruksnummer.ifBlank { r.bruksnummer }
    if (nyttGnr.toIntOrNull() == null) feil += "$hvor: gårdsnummer «$nyttGnr» er ikke et heltall"
    if (nyttBnr.toShortOrNull() == null) {
        feil += "$hvor: bruksnummer «$nyttBnr» må være et heltall ≤ 32767 (backend bruker Short)"
    }
    return feil
}

/**
 * Two rows describing the same source or target ident are always a data error: the source
 * would get two rules (the backend throws "More than one match"), and the target would be
 * created twice.
 */
private fun finnDuplikater(
    rader: List<RadDTO>,
    hva: String,
    ident: (RadDTO) -> String?,
): List<String> =
    rader.mapNotNull { r -> ident(r)?.let { it to r } }
        .groupBy({ it.first }, { it.second })
        .filterValues { it.size > 1 }
        .map { (id, treff) ->
            "samme $hva-ident «$id» på ${treff.joinToString(", ") { it.id }}"
        }

private fun kildeIdent(r: RadDTO): String? = when (r.type) {
    "matrikkelenhet" ->
        "matrikkelenhet ${r.kommunenummer} ${r.gardsnummer}/${r.bruksnummer.ifBlank { "*" }}"
    "teig" -> "teig ${r.kommunenummer} ${r.teigid}"
    "veg" -> "veg ${r.kommunenummer} ${r.adressekode}"
    "vegadresse" -> "vegadresse ${r.kommunenummer} ${r.adressekode}/${r.adressenummer}"
    else -> null
}

private fun målIdent(r: RadDTO): String? {
    val mål = r.nyKommunenummer
    return when (r.type) {
        "matrikkelenhet" -> {
            val gnr = r.nyGardsnummer.ifBlank { r.gardsnummer }
            val bnr = if (r.bruksnummer.isBlank()) "*" else r.nyBruksnummer.ifBlank { r.bruksnummer }
            "matrikkelenhet $mål $gnr/$bnr"
        }
        // The teig keeps its teigId, so the target ident is just the kommune + id.
        "teig" -> "teig $mål ${r.teigid}"
        "veg" -> "veg $mål ${r.nyAdressekode.ifBlank { r.adressekode }}"
        "vegadresse" ->
            "vegadresse $mål ${r.nyAdressekode.ifBlank { r.adressekode }}/" +
                r.nyAdressenummer.ifBlank { r.adressenummer }
        else -> null
    }
}

/**
 * A gårdsnummer cannot both be moved as a whole (blank bruksnummer) and have single bnr
 * listed — the two shapes give conflicting rules on the same gård.
 */
private fun finnMotstridendeGnr(rader: List<RadDTO>): List<String> =
    rader.filter { it.type == "matrikkelenhet" && it.gardsnummer.isNotBlank() }
        .groupBy { it.kommunenummer to it.gardsnummer }
        .filterValues { r -> r.any { it.bruksnummer.isBlank() } && r.any { it.bruksnummer.isNotBlank() } }
        .map { (nøkkel, treff) ->
            val (kommune, gnr) = nøkkel
            "gnr $gnr i kommune $kommune er både oppført som hele gården (blank bruksnummer) " +
                "og med enkelt-bruksnummer, på ${treff.joinToString(", ") { it.id }}"
        }
