package no.komreg.regulering

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/*
 * komreg-backend's Reguleringsinput format — the "parameterfil".
 *
 * Verified against komreg-backend's
 * server/src/main/kotlin/no/kartverket/komreg/routes/Regulering.kt.
 *
 * Field names and @SerialName discriminators must match the backend EXACTLY. The backend
 * installs ContentNegotiation with a default `Json {}` — no ignoreUnknownKeys, no defaults
 * on EndringDTO — so an unknown key, a missing field or the wrong shape all give the same
 * uninformative 500 ("Failed to save Regulering.").
 *
 * ReguleringKontraktTest decodes our output with exactly the same `Json {}` against an
 * independent copy of the backend's DTOs. If you change anything here, run it.
 *
 * The format is documented field by field in `regulering-format.md` in kartverket/smia-docs.
 */

// Its own Json instance — NOT the app's DefaultJson (that one has ignoreUnknownKeys and
// explicitNulls, which are wrong for what we *send out*).
//   - encodeDefaults: EndringDTO's empty lists must be in the payload.
//   - explicitNulls = false: leave out null fields (e.g. an inherited fylke in
//     TilGrunneiendomDTO) so the backend falls back on its defaults instead of explicit nulls.
//   - prettyPrint: the default indent is 4 spaces, like the checked-in reference files.
val reguleringJson = Json {
    prettyPrint = true
    encodeDefaults = true
    explicitNulls = false
}

@Serializable
data class Regulering(
    val id: String,
    val navn: String,
    val dato: String, // ISO "yyyy-MM-dd"; gives the same JSON as the backend's LocalDate
    val endringer: List<EndringDTO>,
)

@Serializable
data class EndringDTO(
    val id: String,
    val navn: String,
    val type: String,
    val utgåendeFylker: List<FylkeDTO>,
    val utgåendeKommuner: List<EnkelKommuneDTO>,
    val nyeFylker: List<FylkeDTO>,
    val nyeKommuner: List<KommuneDTO>,
    val transformasjoner: List<TransformasjonDTO>,
)

@Serializable
sealed class TransformasjonDTO

@Serializable
@SerialName("fylke")
data class FylkeTransformasjonDTO(
    val fylkesnummer: FraEnTilMangeDTO,
    val sammenslaa: Boolean? = false,
) : TransformasjonDTO()

@Serializable
@SerialName("kommune")
data class KommuneTransformasjonDTO(
    val fylkesnummer: FraEnTilMangeDTO,
    val kommuneløpenummer: FraEnTilMangeDTO,
    val sammenslaa: Boolean? = false,
) : TransformasjonDTO()

@Serializable
@SerialName("matrikkelenhet")
data class MatrikkelenhetTransformasjonDTO(
    val fylkesnummer: FraTilDTO,
    val kommuneløpenummer: FraTilDTO,
    val gårdsnummer: FraTilDTO,
    val bruksnummer: Map<String, TilGrunneiendomDTO>? = null,
) : TransformasjonDTO()

@Serializable
@SerialName("krets")
data class KretsTransformasjonDTO(
    val fylkesnummer: FraTilDTO,
    val kommuneløpenummer: FraTilDTO,
    val kretsnummer: FraTilDTO,
    val kretstype: FraTilDTO,
) : TransformasjonDTO()

@Serializable
@SerialName("veg")
data class VegTransformasjonDTO(
    val fylkesnummer: FraEnTilMangeDTO,
    val kommuneløpenummer: FraEnTilMangeDTO,
    val adressekode: FraEnTilMangeDTO,
) : TransformasjonDTO()

@Serializable
@SerialName("teig")
data class TeigTransformasjonDTO(
    val fylkesnummer: FraTilDTO,
    val kommuneløpenummer: FraTilDTO,
    val teigId: FraTilDTO,
) : TransformasjonDTO()

@Serializable
@SerialName("vegadresse")
data class VegadresseTransformasjonDTO(
    val fylkesnummer: FraTilDTO,
    val kommuneløpenummer: FraTilDTO,
    val adressekode: FraTilDTO,
    val adressenummer: FraTilDTO,
) : TransformasjonDTO()

@Serializable
data class FraTilDTO(val fra: String, val til: String)

@Serializable
data class FraEnTilMangeDTO(val fra: String, val til: List<String>)

/**
 * The target for one single bruksnummer, inside the matrikkelenhet's `bruksnummer` map.
 *
 * Two things here are deliberate, not typos:
 *  - The field names lose ø/å (`kommunelopenummer`, `gardsnummer`) even though the rest of
 *    the payload keeps them. That mirrors the backend's TilGrunneiendomDTO.
 *  - The values are NUMBERS, not strings, unlike everything inside fra/til elsewhere. The
 *    backend types them Long?/Byte?/Int?/Short, and the payload that actually ran in prod
 *    writes numbers. Strings happen to work because kotlinx accepts quoted numbers. Do not
 *    go back to strings.
 *
 * A component that is left out inherits the transformasjon's outer `til`. The builder sets
 * all four: when a single bruksnummer moves, the outer `til` equals the source, so
 * inheriting would point the wrong way.
 */
@Serializable
data class TilGrunneiendomDTO(
    val fylkesnummer: Long? = null,
    val kommunelopenummer: Byte? = null,
    val gardsnummer: Int? = null,
    val bruksnummer: Short,
)

@Serializable
data class FylkeDTO(val navn: String, val fylkesnummer: String)

@Serializable
data class EnkelKommuneDTO(val navn: String, val fylkesnummer: String, val kommunenummer: String)

// Only here to mirror EndringDTO.nyeKommuner; a pure grensejustering never touches it
// (always empty). A sammenslåing/deling would fill it — that is out of scope here.
@Serializable
data class KommuneDTO(
    val navn: String,
    val fylkesnummer: String,
    val kommunenummer: String,
    val gyldigTilDato: String? = null,
    val koordinatsystem: Koordinatsystem,
    val senterpunkt: KoordinatDTO,
    val nedsattKonsesjonsgrense: Boolean,
    val godkjenteGardsnumre: List<Gardsnummerserie>,
    val adresse: AdresseDTO?,
    val standardRekvirent: StandardRekvirentDTO?,
    val kommunevapen: String?,
)

@Serializable
data class KoordinatDTO(val x: Double, val y: Double)

@Serializable
data class Gardsnummerserie(val fra: Int, val til: Int)

@Serializable
data class AdresseDTO(
    val adresselinje1: String?,
    val adresselinje2: String?,
    val postnummer: String,
    val poststed: String,
)

@Serializable
data class StandardRekvirentDTO(val orgnummer: String, val navn: String)

@Serializable
enum class Koordinatsystem { UTM32, UTM33, UTM35 }
