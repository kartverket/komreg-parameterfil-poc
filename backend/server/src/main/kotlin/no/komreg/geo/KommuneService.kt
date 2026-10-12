package no.komreg.geo

// The filter and the reduction behind /geo/kommune-teiger-uten-mnr. Pure string/XML work;
// the HTTP exchange and the 502 mapping live in GeoRoutes.

/**
 * Teiger in one kommune that carry no matrikkelnummer ("Mnr mangler" / "Mnr vann mangler").
 *
 * The Teig WFS writes gardsnummer **0** for these where the eiendom API leaves it null — the
 * same disagreement toTeigProps normalises on the frontend.
 */
internal fun kommuneUtenMatrikkelnummerFilter(kommunenummer: String): String =
    """<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:app="$TEIG_NS">""" +
        "<fes:And><fes:PropertyIsEqualTo><fes:ValueReference>" +
        "app:matrikkelenhet/app:Matrikkelenhet/app:kommunenummer" +
        "</fes:ValueReference><fes:Literal>$kommunenummer</fes:Literal>" +
        "</fes:PropertyIsEqualTo><fes:PropertyIsEqualTo><fes:ValueReference>" +
        "app:matrikkelenhet/app:Matrikkelenhet/app:gardsnummer" +
        "</fes:ValueReference><fes:Literal>0</fes:Literal>" +
        "</fes:PropertyIsEqualTo></fes:And></fes:Filter>"

// gml:id="teig.<lokalid>" — the same place parseTeigGml reads a teig's identity on the
// frontend, so ids from here dedupe against map-clicked teiger.
private val TEIG_GML_ID = Regex("""gml:id="teig\.(\d+)"""")

/** Distinct teig-lokalid-er in a WFS FeatureCollection, sorted. */
internal fun teigIder(xml: String): List<Long> =
    TEIG_GML_ID.findAll(xml)
        .mapNotNull { it.groupValues[1].toLongOrNull() }
        .distinct()
        .sorted()
        .toList()
