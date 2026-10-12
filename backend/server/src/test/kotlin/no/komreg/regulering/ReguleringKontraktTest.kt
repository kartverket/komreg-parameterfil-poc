package no.komreg.regulering

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/*
 * The contract test against komreg-backend.
 *
 * The DTOs below are an INDEPENDENT copy of komreg-backend's
 * server/src/main/kotlin/no/kartverket/komreg/routes/Regulering.kt — with the backend's
 * OWN types (Long?/Byte?/Int?/Short where we write numbers, Map<Short, _> for the
 * bruksnummer map). They must NOT share code with the production DTOs in this slice; the
 * whole point is that they are written from the other side of the interface.
 *
 * The decoding uses `Json {}` — exactly what the backend installs
 * (`install(ContentNegotiation) { json() }`, without ignoreUnknownKeys and without
 * defaults). That is the real failure mode: an unknown key, a missing EndringDTO field or
 * a scalar where the backend expects a list all give the same uninformative 500 ("Failed
 * to save Regulering."), so the only way to see it beforehand is to run the payload
 * through the same decoder.
 */
private val backendJson = Json {}

@Serializable
private data class BRegulering(
    val id: String,
    val navn: String,
    // The backend has a kotlinx-datetime LocalDate here. We take it as a String to avoid a
    // new dependency, and parse it with java.time below — which accepts exactly the same
    // ISO-8601 yyyy-MM-dd.
    val dato: String,
    val endringer: List<BEndringDTO>,
)

@Serializable
private data class BEndringDTO(
    val id: String,
    val navn: String,
    val type: String,
    val utgåendeFylker: List<BFylkeDTO>,
    val utgåendeKommuner: List<BEnkelKommuneDTO>,
    val nyeFylker: List<BFylkeDTO>,
    val nyeKommuner: List<BKommuneDTO>,
    val transformasjoner: List<BTransformasjonDTO>,
)

@Serializable
private sealed class BTransformasjonDTO

@Serializable
@SerialName("matrikkelenhet")
private data class BMatrikkelenhet(
    val fylkesnummer: BFraTil,
    val kommuneløpenummer: BFraTil,
    val gårdsnummer: BFraTil,
    val bruksnummer: Map<Short, BTilGrunneiendom>? = null,
) : BTransformasjonDTO()

@Serializable
@SerialName("teig")
private data class BTeig(
    val fylkesnummer: BFraTil,
    val kommuneløpenummer: BFraTil,
    val teigId: BFraTil,
) : BTransformasjonDTO()

@Serializable
@SerialName("veg")
private data class BVeg(
    val fylkesnummer: BFraEnTilMange,
    val kommuneløpenummer: BFraEnTilMange,
    val adressekode: BFraEnTilMange,
) : BTransformasjonDTO()

@Serializable
@SerialName("vegadresse")
private data class BVegadresse(
    val fylkesnummer: BFraTil,
    val kommuneløpenummer: BFraTil,
    val adressekode: BFraTil,
    val adressenummer: BFraTil,
) : BTransformasjonDTO()

@Serializable private data class BFraTil(val fra: String, val til: String)

@Serializable private data class BFraEnTilMange(val fra: String, val til: List<String>)

@Serializable
private data class BTilGrunneiendom(
    val fylkesnummer: Long? = null,
    val kommunelopenummer: Byte? = null,
    val gardsnummer: Int? = null,
    val bruksnummer: Short,
)

@Serializable private data class BFylkeDTO(val navn: String, val fylkesnummer: String)

@Serializable
private data class BEnkelKommuneDTO(
    val navn: String,
    val fylkesnummer: String,
    val kommunenummer: String,
)

@Serializable
private data class BKommuneDTO(
    val navn: String,
    val fylkesnummer: String,
    val kommunenummer: String,
    val gyldigTilDato: String?,
    val koordinatsystem: String,
    val senterpunkt: BKoordinat,
    val nedsattKonsesjonsgrense: Boolean,
    val godkjenteGardsnumre: List<BGardsnummerserie>,
    val adresse: BAdresse?,
    val standardRekvirent: BStandardRekvirent?,
    val kommunevapen: String?,
)

@Serializable private data class BKoordinat(val x: Double, val y: Double)

@Serializable private data class BGardsnummerserie(val fra: Int, val til: Int)

@Serializable
private data class BAdresse(
    val adresselinje1: String?,
    val adresselinje2: String?,
    val postnummer: String,
    val poststed: String,
)

@Serializable private data class BStandardRekvirent(val orgnummer: String, val navn: String)

class ReguleringKontraktTest {

    private val res = genererFiler(
        GenererRequest(
            id = "grensejustering-2027",
            navn = "Grensejusteringer 2027",
            dato = "2027-01-01",
            rader = listOf(
                RadDTO(
                    id = "m:5060-90/4",
                    type = "matrikkelenhet",
                    kommunenummer = "5060",
                    nyKommunenummer = "1811",
                    gardsnummer = "90",
                    bruksnummer = "4",
                    nyGardsnummer = "290",
                    nyBruksnummer = "4",
                ),
                RadDTO(
                    id = "m:5060-91/all",
                    type = "matrikkelenhet",
                    kommunenummer = "5060",
                    nyKommunenummer = "1811",
                    gardsnummer = "91",
                    nyGardsnummer = "291",
                ),
                RadDTO(
                    id = "t:155336128",
                    type = "teig",
                    kommunenummer = "5060",
                    nyKommunenummer = "1811",
                    teigid = "155336128",
                ),
                RadDTO(
                    id = "v:5060-51501/all",
                    type = "veg",
                    kommunenummer = "5060",
                    nyKommunenummer = "1811",
                    adressekode = "51501",
                ),
                RadDTO(
                    id = "v:5060-51505-3045",
                    type = "vegadresse",
                    kommunenummer = "5060",
                    nyKommunenummer = "1811",
                    adressekode = "51505",
                    adressenummer = "3045",
                ),
            ),
        ),
    )

    @Test
    fun `the backend can decode the combined regulering`() {
        val r = backendJson.decodeFromString<BRegulering>(res.samlet.json)
        assertEquals("grensejustering-2027", r.id)
        java.time.LocalDate.parse(r.dato)
        assertEquals(5, r.endringer.single().transformasjoner.size)
    }

    @Test
    fun `the backend can decode each per-kommunepar regulering`() {
        res.perPar.forEach { backendJson.decodeFromString<BRegulering>(it.json) }
    }

    /**
     * The core: the keys of the bruksnummer map must read as Short, and the values as
     * Byte/Int/Short. Writing strings here only works because kotlinx tolerates quoted
     * numbers — so this test would not catch that. What it does catch is what can actually
     * go wrong: overflow, a wrong field, and that ø/å are left out of exactly these field
     * names.
     */
    @Test
    fun `the bruksnummer map reads into the backend's number types`() {
        val r = backendJson.decodeFromString<BRegulering>(res.perPar.single().json)
        val enkelt = r.endringer.single().transformasjoner
            .filterIsInstance<BMatrikkelenhet>()
            .single { it.bruksnummer != null }
        assertEquals(
            BTilGrunneiendom(fylkesnummer = 18, kommunelopenummer = 11, gardsnummer = 290, bruksnummer = 4),
            enkelt.bruksnummer!!.getValue(4),
        )
    }

    @Test
    fun `the whole-gaard shape has no bruksnummer key at all`() {
        val r = backendJson.decodeFromString<BRegulering>(res.samlet.json)
        val hele = r.endringer.single().transformasjoner
            .filterIsInstance<BMatrikkelenhet>()
            .single { it.bruksnummer == null }
        assertEquals(BFraTil("91", "291"), hele.gårdsnummer)
    }

    @Test
    fun `veg decodes as a list, vegadresse as a scalar`() {
        val ts = backendJson.decodeFromString<BRegulering>(res.samlet.json)
            .endringer.single().transformasjoner
        assertEquals(listOf("18"), ts.filterIsInstance<BVeg>().single().fylkesnummer.til)
        assertEquals("11", ts.filterIsInstance<BVegadresse>().single().kommuneløpenummer.til)
    }

    // --- The guards: that the contract really is strict ------------------------------
    //
    // Without these the mirror above could be laxer than the backend without anything
    // failing, and the tests would then say "ok" about a payload the backend answers 500 to.

    @Test
    fun `an unknown key is rejected, as the backend does`() {
        val medEkstra = res.samlet.json.replaceFirst(
            """"navn": "Grensejusteringer 2027",""",
            """"navn": "Grensejusteringer 2027", "kommentar": "notat",""",
        )
        assertFailsWith<Exception> { backendJson.decodeFromString<BRegulering>(medEkstra) }
    }

    @Test
    fun `a missing EndringDTO field is rejected, as the backend does`() {
        val uten = res.samlet.json.replace(Regex(""""utgåendeFylker": \[],\s*"""), "")
        assertFailsWith<Exception> { backendJson.decodeFromString<BRegulering>(uten) }
    }

    @Test
    fun `a scalar where the backend expects a list is rejected`() {
        // Written with escapes, not a raw string: a raw string ending in a quotation mark
        // becomes four in a row, and that is easy to misread.
        val skalar = res.samlet.json.replaceFirst(
            Regex(""""til": \[\s*"18"\s*]"""),
            "\"til\": \"18\"",
        )
        assertFailsWith<Exception> { backendJson.decodeFromString<BRegulering>(skalar) }
    }
}
