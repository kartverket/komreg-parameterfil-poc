package no.komreg.geo

import java.io.StringReader
import java.io.StringWriter
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.transform.OutputKeys
import javax.xml.transform.TransformerFactory
import javax.xml.transform.dom.DOMSource
import javax.xml.transform.stream.StreamResult
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.xml.sax.InputSource

// Building blocks for "every teig in one grunnkrets". Pure string/XML work — the two HTTP
// exchanges themselves live in GeoRoutes, which owns the upstream URLs and the 502 mapping.
//
// Why two steps at all: the Teig WFS can filter by geometry (it advertises Intersects on
// app:område), but a grunnkrets ring runs to ~1800 points, which is an ~88 KB filter — far
// past any GET URL limit. So the grunnkrets is fetched first, its polygon is lifted out, and
// the teig query goes upstream as a WFS POST. The browser only ever sends the 8-digit number.

// The grunnkrets application schema. Versioned in the URI (and https, unlike the teig one),
// so a new edition of the product spec silently breaks the lift below — that is what the
// null return and the 502 in GeoRoutes are for.
internal const val GRUNNKRETS_NS =
    "https://skjema.geonorge.no/SOSI/produktspesifikasjon/StatEnheterGrunnkretser/20240101"
private const val GML_NS = "http://www.opengis.net/gml/3.2"

// grunnkretsnummer is nested (grunnkretsId → GrunnkretsId → grunnkretsnummer); filtering on
// the bare element name is a 400 from the service, not an empty result.
internal fun grunnkretsByNumberFilter(grunnkretsnummer: String): String =
    """<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:app="$GRUNNKRETS_NS">""" +
        "<fes:PropertyIsEqualTo><fes:ValueReference>" +
        "app:grunnkretsId/app:GrunnkretsId/app:grunnkretsnummer" +
        "</fes:ValueReference><fes:Literal>$grunnkretsnummer</fes:Literal>" +
        "</fes:PropertyIsEqualTo></fes:Filter>"

// The grunnkrets containing a map click. Whole-metre EPSG:3857 coordinates: the point only
// has to land inside a polygon, and integers keep both params under the digit guard.
internal fun grunnkretsAtPointFilter(ost: String, nord: String): String =
    """<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:app="$GRUNNKRETS_NS">""" +
        "<fes:Intersects><fes:ValueReference>app:område</fes:ValueReference>" +
        """<gml:Point xmlns:gml="$GML_NS" srsName="EPSG:3857">""" +
        "<gml:pos>$ost $nord</gml:pos></gml:Point></fes:Intersects></fes:Filter>"

// Lift the first grunnkrets' <app:område> geometry out of a WFS response, serialized back to
// XML for splicing into the teig filter. Passing the gml:MultiSurface through untouched —
// rather than pulling coordinates out and rebuilding a polygon — is what makes a grunnkrets
// with islands or exclaves work without any geometry code on our side.
//
// Returns null when the response holds no grunnkrets (an unknown number) or no geometry;
// the caller answers 404, which it can only do because the lookup itself returned 200.
internal fun grunnkretsOmrade(xml: String): String? {
    val doc = secureDocumentBuilderFactory().newDocumentBuilder()
        .parse(InputSource(StringReader(xml)))
    val omrade = doc.getElementsByTagNameNS(GRUNNKRETS_NS, "område").item(0) as? Element
        ?: return null
    val children = omrade.childNodes
    for (i in 0 until children.length) {
        val child = children.item(i)
        if (child.nodeType == Node.ELEMENT_NODE) return serialize(child)
    }
    return null
}

// The WFS 2.0 POST that asks for every teig belonging to `omradeGml`.
//
// Filtered on the teig's **representasjonspunkt**, not its område: a teig belongs to the
// grunnkrets its representative point falls in. Both area rules are wrong in opposite
// directions — Intersects spills whole neighbouring parcels in, Within silently drops parcels
// over a sliver of survey mismatch between the two datasets. Don't "fix" this to app:område;
// the measurements are in docs/adr/0001-grunnkrets-teig-selection.md.
//
// gml is declared here on the root: the lifted subtree uses the gml: prefix but inherits its
// declaration from the response's FeatureCollection, which the serializer need not reproduce.
internal fun teigerInAreaRequest(omradeGml: String): String =
    """<?xml version="1.0" encoding="UTF-8"?>""" +
        """<wfs:GetFeature service="WFS" version="2.0.0"""" +
        """ xmlns:wfs="http://www.opengis.net/wfs/2.0"""" +
        """ xmlns:fes="http://www.opengis.net/fes/2.0"""" +
        """ xmlns:gml="$GML_NS" xmlns:app="$TEIG_NS">""" +
        """<wfs:Query typeNames="app:Teig" srsName="EPSG:3857"><fes:Filter>""" +
        "<fes:Within><fes:ValueReference>app:representasjonspunkt</fes:ValueReference>" +
        omradeGml +
        "</fes:Within></fes:Filter></wfs:Query></wfs:GetFeature>"

// This parser is fed a network response and then hands part of it to another request, so it
// resolves nothing: no doctype, no external entities, no schema fetch.
private fun secureDocumentBuilderFactory(): DocumentBuilderFactory =
    DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        setFeature("http://xml.org/sax/features/external-general-entities", false)
        setFeature("http://xml.org/sax/features/external-parameter-entities", false)
        isExpandEntityReferences = false
    }

private fun serialize(node: Node): String {
    val out = StringWriter()
    TransformerFactory.newInstance().apply {
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
    }.newTransformer().apply {
        setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "yes")
    }.transform(DOMSource(node), StreamResult(out))
    return out.toString()
}
