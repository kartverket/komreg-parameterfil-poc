package no.komreg.geo

import io.ktor.client.HttpClient
import io.ktor.client.plugins.timeout
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.log
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import java.io.IOException
import java.net.URLEncoder
import java.nio.channels.UnresolvedAddressException
import no.komreg.Kode
import no.komreg.problem

// The upstream services behind /geo/*. We proxy the raw payload; the frontend parses it,
// so the response is passed through verbatim.
private const val ADRESSE_SOK = "https://ws.geonorge.no/adresser/v1/sok"
private const val EIENDOM_GEOKODING = "https://api.kartverket.no/eiendom/v1/geokoding"
private const val KOMMUNEINFO_SOK = "https://api.kartverket.no/kommuneinfo/v1/sok"
private const val KOMMUNEINFO_KOMMUNER = "https://api.kartverket.no/kommuneinfo/v1/kommuner"
private const val MATRIKKEL_TEIG_WFS =
    "https://wfs.geonorge.no/skwms1/wfs.matrikkelen-eiendomskart-teig"

// Statistical units: grunnkrets polygons, served in EPSG:3857 like everything else here.
private const val GRUNNKRETSER_WFS = "https://wfs.geonorge.no/skwms1/wfs.grunnkretser"

// internal: GrunnkretsService builds the teig POST body against this same schema.
internal const val TEIG_NS =
    "http://skjema.geonorge.no/SOSI/produktspesifikasjon/Matrikkelen-Eiendomskart-Teig/20211101"

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

// Cadastral identifiers (kommunenummer, gardsnummer, bruksnummer, festenummer,
// adressekode) are always plain digit strings. On the routes that use this, the digit
// guard is what keeps the hand-built FES/XML filter below safe: these values are spliced
// in unescaped, so an unvalidated one could break out of <fes:Literal>.
private fun isNumeric(s: String) = s.isNotEmpty() && s.all(Char::isDigit)

// Required *and* numeric in one pass, so a new route can't check presence and forget
// digit-ness; a missing value and a non-digit one are both a 400, so they collapse
// cleanly. Params with a "0" default are never null here — passing them through costs
// nothing and keeps every value that reaches the FES filter behind one guard.
private fun allNumeric(vararg values: String?) =
    values.all { !it.isNullOrBlank() && isNumeric(it) }

// The two free-text params (`sok`, `navn`) can't be digit-guarded. Neither reaches the
// FES filter, but both are encoded straight into an upstream query string, so cap the
// length rather than relaying an unbounded string to Geonorge — a real street or kommune
// name is far below this.
private const val MAX_FREE_TEXT = 100

// kommunenummer (4) + kretsnummer (4). Checked as well as the digit guard so a mistyped
// number fails here rather than as an empty upstream result the frontend has to interpret.
private const val GRUNNKRETSNUMMER_LENGTH = 8

// The client's global 10s request timeout is right for every per-teig and per-address
// lookup here, and it is what stops a hanging upstream from tying up a request. A
// whole-kommune query is a different kind of call and blows straight through it: measured
// against Geonorge, the matrikkelnummer-less teig query is ~8s for Moskenes' 642. So it
// overrides the timeout per request rather than the global value being raised — raising it
// would take the guard off every other route.
//
// The user is waiting on it, so a long ceiling costs nothing; it is a backstop against a
// hung connection, not a latency budget.
//
// Note this is far longer than shutdownGracePeriod (12s), so a rolling restart will cut the
// call off mid-flight rather than drain it. Accepted: the frontend reports it as a failed
// lookup and the user tries again — nothing is half-written.
private const val LONG_UPSTREAM_TIMEOUT_MS = 180_000L

// One upstream exchange, with every failure collapsed to null so each route answers 502 in
// one place. Unreachable, timed out, or anything but 200 is a gateway failure, not an
// internal error. `what` identifies the call in the log — the routes pass the URL.
//
// Separate from serveProxied because the grunnkrets route makes two of these (a GET, then a
// POST) before it has a body worth returning, and a second copy of this mapping would be one
// more place for the 502/500 distinction to drift.
private suspend fun ApplicationCall.upstream(
    what: String,
    exchange: suspend () -> HttpResponse,
): HttpResponse? {
    val resp = try {
        exchange()
    } catch (e: IOException) {
        application.log.warn("geo upstream failed for $what", e)
        return null
    } catch (e: UnresolvedAddressException) {
        // DNS failure in the CIO client surfaces as this, which extends
        // IllegalArgumentException rather than IOException — same 502, though.
        application.log.warn("geo upstream DNS lookup failed for $what", e)
        return null
    }
    if (resp.status != HttpStatusCode.OK) {
        // The caller gets a bare 502 — leave a trace of what upstream actually said.
        application.log.warn("geo upstream returned {} for {}", resp.status, what)
        return null
    }
    return resp
}

// Pass an upstream response through verbatim, body and Content-Type both.
private suspend fun ApplicationCall.serveBody(resp: HttpResponse) =
    respondText(resp.bodyAsText(), resp.contentType() ?: ContentType.Application.Json)

// One whole-kommune GET, on the long ceiling above rather than the client's
// global one. Same 502 mapping as everything else — only the timeout differs.
private suspend fun ApplicationCall.longUpstream(
    client: HttpClient,
    url: String,
): HttpResponse? = upstream(url) {
    client.get(url) { timeout { requestTimeoutMillis = LONG_UPSTREAM_TIMEOUT_MS } }
}

// HTTP glue for the plain proxy routes: fetch and pass through, or 502.
private suspend fun ApplicationCall.serveProxied(client: HttpClient, url: String) {
    val resp =
        upstream(url) { client.get(url) } ?: return problem(HttpStatusCode.BadGateway, Kode.OPPSTROMS_UTILGJENGELIG)
    serveBody(resp)
}

fun Route.geoRoutes(client: HttpClient) {
    route("/geo") {
        // Addresses for a matrikkelenhet (gnr/bnr/fnr). `side` pages through
        // results past the upstream page cap (the frontend follows
        // metadata.totaltAntallTreff).
        get("/addresses") {
            val k = call.request.queryParameters["kommunenummer"]
            val g = call.request.queryParameters["gardsnummer"]
            val b = call.request.queryParameters["bruksnummer"] ?: "0"
            val f = call.request.queryParameters["festenummer"] ?: "0"
            val side = call.request.queryParameters["side"] ?: "0"
            if (!allNumeric(k, g, b, f, side)) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            val url = "$ADRESSE_SOK?fuzzy=false&kommunenummer=$k&gardsnummer=$g" +
                "&bruksnummer=$b&festenummer=$f&utkoordsys=3857&treffPerSide=1000&side=$side&asciiKompatibel=true"
            call.serveProxied(client, url)
        }

        // Address search within one kommune. Takes a free-text street name (sok=) or an
        // exact numeric adressekode (the frontend picks which based on the user's input).
        // Also backs the adressekode "whole street" coverage check (fetchAdressekodeNumbers).
        get("/adresse-sok") {
            val k = call.request.queryParameters["kommunenummer"]
            val sok = call.request.queryParameters["sok"]
            val ak = call.request.queryParameters["adressekode"]
            val side = call.request.queryParameters["side"] ?: "0"
            if (!allNumeric(k, side) || (sok.isNullOrBlank() && ak.isNullOrBlank())) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            if (!ak.isNullOrBlank() && !isNumeric(ak)) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            // sok only drives the query when adressekode is absent (guard above proves
            // one of them is set), so it's non-null exactly here.
            if (ak.isNullOrBlank() && sok!!.length > MAX_FREE_TEXT) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            val filter = if (!ak.isNullOrBlank()) "adressekode=$ak" else "sok=${enc(sok!!)}"
            val url = "$ADRESSE_SOK?fuzzy=false&kommunenummer=$k&$filter" +
                "&utkoordsys=3857&treffPerSide=1000&side=$side&asciiKompatibel=true"
            call.serveProxied(client, url)
        }

        // All teiger of a matrikkelenhet (gnr/bnr), GeoJSON.
        get("/matrikkel-teiger") {
            val k = call.request.queryParameters["kommunenummer"]
            val g = call.request.queryParameters["gardsnummer"]
            val b = call.request.queryParameters["bruksnummer"] ?: "0"
            if (!allNumeric(k, g, b)) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            val url = "$EIENDOM_GEOKODING?omrade=true&kommunenummer=$k&gardsnummer=$g" +
                "&bruksnummer=$b&utkoordsys=3857"
            call.serveProxied(client, url)
        }

        // Every teig in a gnr-serie via the Teig WFS (GML, FES filter by kommune+gnr).
        get("/gnr-teiger") {
            val k = call.request.queryParameters["kommunenummer"]
            val g = call.request.queryParameters["gardsnummer"]
            if (!allNumeric(k, g)) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            val filter =
                "<fes:Filter xmlns:fes=\"http://www.opengis.net/fes/2.0\" xmlns:app=\"$TEIG_NS\">" +
                    "<fes:And><fes:PropertyIsEqualTo>" +
                    "<fes:ValueReference>app:matrikkelenhet/app:Matrikkelenhet/app:kommunenummer</fes:ValueReference>" +
                    "<fes:Literal>$k</fes:Literal></fes:PropertyIsEqualTo>" +
                    "<fes:PropertyIsEqualTo>" +
                    "<fes:ValueReference>app:matrikkelenhet/app:Matrikkelenhet/app:gardsnummer</fes:ValueReference>" +
                    "<fes:Literal>$g</fes:Literal></fes:PropertyIsEqualTo>" +
                    "</fes:And></fes:Filter>"
            val url = "$MATRIKKEL_TEIG_WFS?service=WFS&version=2.0.0&request=GetFeature" +
                "&typeNames=${enc("app:Teig")}&srsName=${enc("EPSG:3857")}&filter=${enc(filter)}"
            call.serveProxied(client, url)
        }

        // Kommune name search (place navigation). The response already carries each
        // kommune's avgrensningsboks, so the frontend can fly to it without a detail call.
        get("/kommune-sok") {
            val navn = call.request.queryParameters["navn"]
            if (navn.isNullOrBlank() || navn.length > MAX_FREE_TEXT) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            // knavn supports a trailing * wildcard (prefix match); utkoordsys=4258 → lon/lat,
            // which fromLonLat consumes directly on the frontend.
            val url = "$KOMMUNEINFO_SOK?knavn=${enc("$navn*")}&utkoordsys=4258"
            call.serveProxied(client, url)
        }

        // Every kommune (nummer + navn) in one payload, so the frontend can tell whether a
        // typed kommunenummer exists at all. Deliberately the whole list rather than a
        // per-number lookup: any non-200 becomes a 502, so an upstream 404 for "no such
        // kommune" would be indistinguishable from an outage — and reporting "kommunen
        // finnes ikke" because the network blipped is the one answer this check must
        // never give.
        get("/kommuner") {
            val url = "$KOMMUNEINFO_KOMMUNER?filtrer=${enc("kommunenummer,kommunenavn")}"
            call.serveProxied(client, url)
        }

        // The grunnkrets containing a map click — nummer, navn and the polygon, so the
        // frontend can both name what was picked and draw its outline. Coordinates are
        // whole-metre EPSG:3857, which keeps them under the digit guard.
        get("/grunnkrets-punkt") {
            val ost = call.request.queryParameters["ost"]
            val nord = call.request.queryParameters["nord"]
            if (!allNumeric(ost, nord)) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            val filter = grunnkretsAtPointFilter(ost!!, nord!!)
            val url = "$GRUNNKRETSER_WFS?service=WFS&version=2.0.0&request=GetFeature" +
                "&typeNames=${enc("app:Grunnkrets")}&srsName=${enc("EPSG:3857")}" +
                "&filter=${enc(filter)}"
            call.serveProxied(client, url)
        }

        // Teiger in a kommune with no matrikkelnummer, by lokalid. The check against the
        // matrikkel (frontend matrikkelsjekk.ts) uses it to tell whether a saved mnr-less
        // teig still exists.
        //
        // One of the /geo routes that **reduces** the upstream payload instead of passing it
        // through verbatim: what comes back is megabytes of polygons and what the frontend
        // needs is a list of integers. The reduction lives in a pure service
        // (KommuneService); the route keeps only the HTTP.
        get("/kommune-teiger-uten-mnr") {
            val k = call.request.queryParameters["kommunenummer"]
            if (!allNumeric(k)) return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            // No srsName: we only read gml:id off each feature, and asking for a projection
            // doesn't make the geometry we throw away any cheaper.
            val url = "$MATRIKKEL_TEIG_WFS?service=WFS&version=2.0.0&request=GetFeature" +
                "&typeNames=${enc("app:Teig")}" +
                "&filter=${enc(kommuneUtenMatrikkelnummerFilter(k!!))}"
            val resp = call.longUpstream(client, url)
                ?: return@get call.problem(HttpStatusCode.BadGateway, Kode.OPPSTROMS_UTILGJENGELIG)
            call.respond(teigIder(resp.bodyAsText()))
        }

        // Every teig touching one grunnkrets — the whole point of the two-step in
        // GrunnkretsService. Two upstream calls, so this route can't use serveProxied.
        get("/grunnkrets-teiger") {
            val nr = call.request.queryParameters["grunnkretsnummer"]
            // A grunnkretsnummer is kommunenummer + 4 digits, always exactly 8.
            if (!allNumeric(nr) || nr!!.length != GRUNNKRETSNUMMER_LENGTH) {
                return@get call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
            val kretsUrl = "$GRUNNKRETSER_WFS?service=WFS&version=2.0.0&request=GetFeature" +
                "&typeNames=${enc("app:Grunnkrets")}&srsName=${enc("EPSG:3857")}" +
                "&filter=${enc(grunnkretsByNumberFilter(nr))}"
            val krets = call.upstream(kretsUrl) { client.get(kretsUrl) }
                ?: return@get call.problem(HttpStatusCode.BadGateway, Kode.OPPSTROMS_UTILGJENGELIG)

            // The lookup answered 200, so an empty result really is "no such grunnkrets"
            // and not an outage — the one case where 404 is honest here.
            val omrade = grunnkretsOmrade(krets.bodyAsText())
                ?: return@get call.problem(HttpStatusCode.NotFound, Kode.FINNES_IKKE)

            val teiger = call.upstream("teiger i grunnkrets $nr") {
                client.post(MATRIKKEL_TEIG_WFS) {
                    contentType(ContentType.Text.Xml)
                    setBody(teigerInAreaRequest(omrade))
                }
            } ?: return@get call.problem(HttpStatusCode.BadGateway, Kode.OPPSTROMS_UTILGJENGELIG)
            call.serveBody(teiger)
        }
    }
}
