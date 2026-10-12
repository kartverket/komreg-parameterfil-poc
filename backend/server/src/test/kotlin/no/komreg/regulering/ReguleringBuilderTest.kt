package no.komreg.regulering

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

// The reference rows: ten matrikkelenheter renumbered into Bindal, one teig, one whole veg
// and one vegadresse. 5060 -> 1811 crosses the fylke boundary (50 -> 18).
private fun mnr(gnr: String, bnr: String, nyttGnr: String) = RadDTO(
    id = "m:5060-$gnr/$bnr",
    type = "matrikkelenhet",
    kommunenummer = "5060",
    nyKommunenummer = "1811",
    gardsnummer = gnr,
    bruksnummer = bnr,
    nyGardsnummer = nyttGnr,
    nyBruksnummer = bnr,
)

private val NAEROEYSUND_BINDAL: List<RadDTO> =
    listOf("4", "5", "9", "10", "11", "36", "37", "38").map { mnr("90", it, "290") } +
        mnr("152", "1", "352") +
        mnr("153", "1", "353") +
        RadDTO(
            id = "t:155336128",
            type = "teig",
            kommunenummer = "5060",
            nyKommunenummer = "1811",
            teigid = "155336128",
        ) +
        RadDTO(
            id = "v:5060-51501/all",
            type = "veg",
            kommunenummer = "5060",
            nyKommunenummer = "1811",
            adressekode = "51501",
        ) +
        RadDTO(
            id = "v:5060-51505-3045",
            type = "vegadresse",
            kommunenummer = "5060",
            nyKommunenummer = "1811",
            adressekode = "51505",
            adressenummer = "3045",
        )

private val REQ = GenererRequest(
    id = "grensejustering-2027",
    navn = "Grensejusteringer 2027",
    dato = "2027-01-01",
    rader = NAEROEYSUND_BINDAL,
)

private fun ReguleringFil.regulering(): String =
    reguleringJson.decodeFromString<Regulering>(json).id

class ReguleringBuilderTest {

    /**
     * The reference payload, character for character.
     *
     * The file follows the payloads that actually ran for two of the 2027 justeringer.
     *
     * ONE DELIBERATE DIFFERENCE from the original: the values inside the bruksnummer maps
     * are numbers here, strings there. See TilGrunneiendomDTO. Do not "fix" it back.
     */
    @Test
    fun `reproduces the checked-in Naeroeysund-Bindal payload`() {
        val forventet = javaClass.getResource("/regulering/grensejustering-5060-1811.json")!!
            .readText()
        val res = genererFiler(REQ)
        assertEquals(1, res.perPar.size)
        assertEquals(forventet, res.perPar.single().json)
    }

    @Test
    fun `the combined file carries the metadata and the same endringer`() {
        val res = genererFiler(REQ)
        val samlet = reguleringJson.decodeFromString<Regulering>(res.samlet.json)
        assertEquals("grensejustering-2027", samlet.id)
        assertEquals("Grensejusteringer 2027", samlet.navn)
        assertEquals("2027-01-01", samlet.dato)
        val par = reguleringJson.decodeFromString<Regulering>(res.perPar.single().json)
        assertEquals(par.endringer, samlet.endringer)
        // Its own id, or the per-pair file collides with the combined one on the backend's primary key.
        assertEquals("grensejustering-2027-5060-1811", par.id)
    }

    @Test
    fun `counts transformasjoner per type and names the files after the regulering id`() {
        val res = genererFiler(REQ)
        assertEquals(
            mapOf("matrikkelenhet" to 10, "teig" to 1, "veg" to 1, "vegadresse" to 1),
            res.samlet.antall,
        )
        assertEquals("grensejustering-2027-samlet.json", res.samlet.filnavn)
        assertEquals("grensejustering-2027-5060-1811.json", res.perPar.single().filnavn)
    }

    @Test
    fun `emits matrikkelenhet - teig - veg - vegadresse`() {
        val ts = byggEndringer(NAEROEYSUND_BINDAL).single().endring.transformasjoner
        val typer = ts.map { it::class.simpleName }
        assertEquals(
            List(10) { "MatrikkelenhetTransformasjonDTO" } + listOf(
                "TeigTransformasjonDTO",
                "VegTransformasjonDTO",
                "VegadresseTransformasjonDTO",
            ),
            typer,
        )
    }

    // --- The shapes ------------------------------------------------------------------

    private fun enTransformasjon(vararg rader: RadDTO) =
        byggEndringer(rader.toList()).single().endring.transformasjoner.single()

    /**
     * The asymmetry that is easy to "tidy" to pieces: with a bruksnummer the WHOLE outer
     * object is held (fylke, kommune and gnr), and the target sits in the nested map. The
     * backend drops the outer gårdsnummer-serie rule only when the outer fra == til;
     * otherwise every bnr row on the same gård gives an identical, equally specific rule ->
     * "More than one match" in IdentTransformer.
     */
    @Test
    fun `holds the whole outer object, and nests the target, when a single bruksnummer moves`() {
        val t = enTransformasjon(mnr("90", "4", "290")) as MatrikkelenhetTransformasjonDTO
        assertEquals(FraTilDTO("50", "50"), t.fylkesnummer)
        assertEquals(FraTilDTO("60", "60"), t.kommuneløpenummer)
        assertEquals(FraTilDTO("90", "90"), t.gårdsnummer)
        assertEquals(
            mapOf(
                "4" to TilGrunneiendomDTO(
                    fylkesnummer = 18,
                    kommunelopenummer = 11,
                    gardsnummer = 290,
                    bruksnummer = 4,
                ),
            ),
            t.bruksnummer,
        )
    }

    /**
     * Regression: the outer fylke was 50 -> 18 with kommune 60 -> 60. Across fylker the
     * backend read that as a rule of its own, gård 5060-90 -> 1860-90 (Vestvågøy), once per
     * bnr row. Inside one fylke the outer fra == til anyway, so the bug was invisible in
     * the payloads that ran in prod.
     */
    @Test
    fun `moving a single bruksnummer across fylker does not change the outer gaard`() {
        val ts = byggEndringer(listOf(mnr("90", "4", "290"), mnr("90", "5", "290")))
            .single().endring.transformasjoner.map { it as MatrikkelenhetTransformasjonDTO }
        ts.forEach {
            assertEquals(it.fylkesnummer.fra, it.fylkesnummer.til)
            assertEquals(it.kommuneløpenummer.fra, it.kommuneløpenummer.til)
            assertEquals(it.gårdsnummer.fra, it.gårdsnummer.til)
            assertEquals(18L, it.bruksnummer!!.values.single().fylkesnummer)
        }
    }

    @Test
    fun `moves the outer object and leaves out the bruksnummer map for a whole gaard`() {
        val hele = RadDTO(
            id = "m:5060-90/all",
            type = "matrikkelenhet",
            kommunenummer = "5060",
            nyKommunenummer = "1811",
            gardsnummer = "90",
            nyGardsnummer = "290",
        )
        val t = enTransformasjon(hele) as MatrikkelenhetTransformasjonDTO
        assertEquals(FraTilDTO("60", "11"), t.kommuneløpenummer)
        assertEquals(FraTilDTO("90", "290"), t.gårdsnummer)
        assertNull(t.bruksnummer)
        // explicitNulls = false => the key must not be in the JSON at all.
        assertTrue("bruksnummer" !in reguleringJson.encodeToString(t))
    }

    @Test
    fun `veg uses the list form, vegadresse a scalar`() {
        val veg = enTransformasjon(
            RadDTO("v", "veg", "5060", "1811", adressekode = "51501"),
        ) as VegTransformasjonDTO
        assertEquals(FraEnTilMangeDTO("50", listOf("18")), veg.fylkesnummer)
        assertEquals(FraEnTilMangeDTO("51501", listOf("51501")), veg.adressekode)

        val adr = enTransformasjon(
            RadDTO("v", "vegadresse", "5060", "1811", adressekode = "51505", adressenummer = "3045"),
        ) as VegadresseTransformasjonDTO
        assertEquals(FraTilDTO("60", "11"), adr.kommuneløpenummer)
        assertEquals(FraTilDTO("3045", "3045"), adr.adressenummer)
    }

    @Test
    fun `a teig keeps its id and moves only the kommune prefix`() {
        val t = enTransformasjon(
            RadDTO("t", "teig", "5060", "1811", teigid = "155336128"),
        ) as TeigTransformasjonDTO
        assertEquals(FraTilDTO("50", "18"), t.fylkesnummer)
        assertEquals(FraTilDTO("155336128", "155336128"), t.teigId)
    }

    @Test
    fun `falls back on the current values when no new ones are set`() {
        val r = RadDTO(
            id = "m",
            type = "matrikkelenhet",
            kommunenummer = "5060",
            nyKommunenummer = "1811",
            gardsnummer = "90",
            bruksnummer = "4",
        )
        val t = enTransformasjon(r) as MatrikkelenhetTransformasjonDTO
        assertEquals(
            TilGrunneiendomDTO(fylkesnummer = 18, kommunelopenummer = 11, gardsnummer = 90, bruksnummer = 4),
            t.bruksnummer!!.getValue("4"),
        )
    }

    // --- Grouping --------------------------------------------------------------------

    @Test
    fun `one endring per kommunepar, in the order the pairs appear`() {
        val rader = listOf(
            mnr("90", "4", "290"),
            mnr("91", "1", "291").copy(id = "m:5061", kommunenummer = "5061"),
        )
        val par = byggEndringer(rader)
        assertEquals(listOf("5060-1811", "5061-1811"), par.map { it.endring.id })
    }

    @Test
    fun `a source kommune split across two targets becomes two endringer`() {
        val rader = listOf(
            mnr("90", "4", "290"),
            mnr("91", "1", "291").copy(id = "m:2", nyKommunenummer = "1812"),
        )
        assertEquals(listOf("5060-1811", "5060-1812"), byggEndringer(rader).map { it.endring.id })
    }

    /**
     * The core rule for what is downloaded: N kommunepar give N+1 files — one per pair,
     * plus the combined one with every pair as its own endring.
     *
     * The rows can come from several saved lists; a list is how the selection work is
     * organised, not a regulering in itself. The regulering is the union of them.
     */
    @Test
    fun `three kommunepar give four files`() {
        val rader = listOf(
            mnr("90", "4", "290"),
            mnr("91", "1", "291").copy(id = "m:2", kommunenummer = "5061"),
            mnr("92", "1", "292").copy(id = "m:3", kommunenummer = "5062"),
        )
        val res = genererFiler(REQ.copy(rader = rader))

        assertEquals(3, res.perPar.size)
        assertEquals(4, 1 + res.perPar.size)
        assertEquals(
            listOf("5060-1811", "5061-1811", "5062-1811"),
            res.perPar.map { it.key },
        )

        // The combined one carries all three, each as its own endring...
        val samlet = reguleringJson.decodeFromString<Regulering>(res.samlet.json)
        assertEquals(3, samlet.endringer.size)
        assertEquals(3, res.samlet.antall.getValue("matrikkelenhet"))

        // ...while each per-pair file carries exactly its own.
        res.perPar.forEach { fil ->
            val par = reguleringJson.decodeFromString<Regulering>(fil.json)
            assertEquals(1, par.endringer.size)
            assertEquals(fil.key, par.endringer.single().id)
            // Its own id, or the files collide with each other and with the combined one
            // on the backend's primary key.
            assertEquals("${REQ.id}-${fil.key}", par.id)
        }
        assertEquals(
            4,
            (res.perPar.map { it.regulering() } + samlet.id).distinct().size,
        )
    }

    // --- Validation ------------------------------------------------------------------

    private fun feilFra(vararg rader: RadDTO): List<String> =
        assertFailsWith<UgyldigReguleringException> { byggEndringer(rader.toList()) }.feil

    @Test
    fun `collects every error instead of stopping at the first`() {
        val feil = feilFra(
            RadDTO(id = "a", type = "matrikkelenhet", kommunenummer = "", nyKommunenummer = ""),
            RadDTO(id = "b", type = "teig", kommunenummer = "5060", nyKommunenummer = "1811"),
        )
        assertTrue(feil.size >= 4, "forventet flere feil, fikk $feil")
        assertTrue(feil.any { "a" in it && "mangler kommunenummer" in it })
        assertTrue(feil.any { "b" in it && "mangler teigid" in it })
    }

    @Test
    fun `rejects a kommunenummer that is not four digits, and a target equal to the source`() {
        assertTrue(
            feilFra(mnr("90", "4", "290").copy(nyKommunenummer = "181"))
                .any { "må være 4 siffer" in it },
        )
        assertTrue(
            feilFra(mnr("90", "4", "290").copy(nyKommunenummer = "5060"))
                .any { "ingen flytting" in it },
        )
    }

    // A duplicate source ident would give two equally specific rules on the same ident; a
    // duplicate target ident would create the same thing twice.
    @Test
    fun `rejects duplicate source and target idents`() {
        assertTrue(
            feilFra(mnr("90", "4", "290"), mnr("90", "4", "290").copy(id = "m:2"))
                .any { "samme kilde-ident" in it },
        )
        assertTrue(
            feilFra(mnr("90", "4", "290"), mnr("91", "5", "290").copy(id = "m:2", nyBruksnummer = "4"))
                .any { "samme mål-ident" in it },
        )
    }

    @Test
    fun `rejects a gnr that both moves as a whole and has single bruksnummer`() {
        val hele = mnr("90", "", "290").copy(id = "m:all", nyBruksnummer = "")
        assertTrue(feilFra(hele, mnr("90", "4", "290")).any { "hele gården" in it })
    }

    // The backend only parses bruksnummer as a Short at GET /run — an overflow there is a
    // 500 in the middle of a kjøring, not an error message when the parameterfil is built.
    @Test
    fun `rejects a bruksnummer that is not a Short`() {
        assertTrue(
            feilFra(mnr("90", "4", "290").copy(nyBruksnummer = "40000"))
                .any { "32767" in it },
        )
    }

    @Test
    fun `metadata is validated on its own`() {
        assertTrue(validerMetadata(REQ).isEmpty())
        assertTrue(validerMetadata(REQ.copy(id = " ")).any { "mangler id" in it })
        assertTrue(validerMetadata(REQ.copy(dato = "01.01.2027")).any { "ÅÅÅÅ-MM-DD" in it })
        assertTrue(validerMetadata(REQ.copy(rader = emptyList())).any { "Ingen rader" in it })
    }
}
