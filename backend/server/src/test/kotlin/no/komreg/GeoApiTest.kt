package no.komreg

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.plugins.di.dependencies
import io.ktor.server.plugins.di.provide
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import no.komreg.geo.GRUNNKRETS_NS
import no.komreg.geo.TEIG_NS

class GeoApiTest {
    @Test
    fun `passes the upstream response through on every call`() = testApplication {
        var hits = 0
        val upstream = HttpClient(
            MockEngine {
                hits++
                respond(
                    """{"adresser":[]}""",
                    HttpStatusCode.OK,
                    headersOf(HttpHeaders.ContentType, "application/json"),
                )
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        val q = "/api/geo/addresses?kommunenummer=1101&gardsnummer=42"
        val first = client.get(q)
        assertEquals(HttpStatusCode.OK, first.status)
        assertEquals("""{"adresser":[]}""", first.bodyAsText())
        // Content-Type comes from upstream, not from us (the GML routes rely on this).
        assertTrue(first.headers[HttpHeaders.ContentType]!!.startsWith("application/json"))
        assertEquals(1, hits)

        // Nothing is stored: the same query goes upstream again. That is the contract —
        // cadastral data must not be served from a stale copy.
        val second = client.get(q)
        assertEquals(HttpStatusCode.OK, second.status)
        assertEquals("""{"adresser":[]}""", second.bodyAsText())
        assertEquals(2, hits)
    }

    @Test
    fun `rejects non-numeric params`() = testApplication {
        var hits = 0
        val upstream = HttpClient(
            MockEngine {
                hits++
                respond("{}", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        // Non-numeric identifiers must be stopped before any upstream call — they get
        // spliced unescaped into the WFS filter XML.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/addresses?kommunenummer=abc&gardsnummer=1").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/addresses?gardsnummer=1").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/addresses?kommunenummer=1102&gardsnummer=1&side=x").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/gnr-teiger?kommunenummer=1102&gardsnummer=1e2").status,
        )
        assertEquals(0, hits)
    }

    @Test
    fun `upstream failure gives 502`() = testApplication {
        var fail = true
        var hits = 0
        val upstream = HttpClient(
            MockEngine {
                hits++
                if (fail) {
                    respondError(HttpStatusCode.InternalServerError)
                } else {
                    respond(
                        """{"ok":true}""",
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, "application/json"),
                    )
                }
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        val q = "/api/geo/addresses?kommunenummer=1103&gardsnummer=7"
        assertEquals(HttpStatusCode.BadGateway, client.get(q).status)

        // A non-200 is mapped to 502 and nothing else — the next call just tries again.
        fail = false
        val ok = client.get(q)
        assertEquals(HttpStatusCode.OK, ok.status)
        assertEquals("""{"ok":true}""", ok.bodyAsText())
        assertEquals(2, hits)
    }

    @Test
    fun `rejects over-long free-text params`() = testApplication {
        var hits = 0
        val upstream = HttpClient(
            MockEngine {
                hits++
                respond("{}", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        // sok and navn are the two params the digit guard can't cover; the length cap is
        // what stops an unbounded string being relayed into an upstream query string.
        val long = "a".repeat(200)
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/adresse-sok?kommunenummer=1104&sok=$long").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/kommune-sok?navn=$long").status,
        )
        assertEquals(0, hits)

        // A realistic term still goes through.
        assertEquals(
            HttpStatusCode.OK,
            client.get("/api/geo/kommune-sok?navn=Drammen").status,
        )
        assertEquals(1, hits)
    }

    @Test
    fun `kommuner list is served verbatim`() = testApplication {
        var hits = 0
        val body = """[{"kommunenummer":"4601","kommunenavn":"Bergen"}]"""
        val upstream = HttpClient(
            MockEngine {
                hits++
                respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        // Takes no params, so there is nothing to reject — the point is that the whole
        // list comes back unmodified, since the frontend uses it to tell a mistyped
        // kommunenummer from a real one.
        val res = client.get("/api/geo/kommuner")
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals(body, res.bodyAsText())
        assertEquals(1, hits)
    }

    // ---- /geo/grunnkrets-teiger ------------------------------------------------------
    //
    // The only route that makes two upstream calls: a GET for the grunnkrets polygon, then a
    // POST carrying that polygon to the teig WFS. The mock engine therefore dispatches on
    // method, and the assertions are about what crosses between the two — a filter that loses
    // the geometry would still return teiger upstream, just the wrong ones.

    private val grunnkretsGml = """
        <wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
            xmlns:gml="http://www.opengis.net/gml/3.2">
          <wfs:member>
            <app:Grunnkrets xmlns:app="$GRUNNKRETS_NS">
              <app:grunnkretsId><app:GrunnkretsId>
                <app:grunnkretsnummer>15250101</app:grunnkretsnummer>
              </app:GrunnkretsId></app:grunnkretsId>
              <app:grunnkretsnavn>Liabygda</app:grunnkretsnavn>
              <app:område>
                <gml:MultiSurface srsName="EPSG:3857"><gml:surfaceMember><gml:Polygon>
                  <gml:exterior><gml:LinearRing>
                    <gml:posList>0 0 10 0 10 10 0 10 0 0</gml:posList>
                  </gml:LinearRing></gml:exterior>
                </gml:Polygon></gml:surfaceMember></gml:MultiSurface>
              </app:område>
            </app:Grunnkrets>
          </wfs:member>
        </wfs:FeatureCollection>
    """.trimIndent()

    private val teigGml = """<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"/>"""

    @Test
    fun `grunnkrets teiger posts the krets polygon to the teig WFS`() = testApplication {
        var postBody = ""
        var gets = 0
        val upstream = HttpClient(
            MockEngine { request ->
                if (request.method == HttpMethod.Post) {
                    postBody = (request.body as TextContent).text
                    respond(teigGml, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "text/xml"))
                } else {
                    gets++
                    assertContains(request.url.toString(), "wfs.grunnkretser")
                    respond(
                        grunnkretsGml,
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, "text/xml"),
                    )
                }
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        val res = client.get("/api/geo/grunnkrets-teiger?grunnkretsnummer=15250101")
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals(teigGml, res.bodyAsText())
        assertEquals(1, gets)

        // The lifted geometry has to survive into the POST, coordinates and all.
        assertContains(postBody, "app:Teig")
        assertContains(postBody, "0 0 10 0 10 10 0 10 0 0")
        assertContains(postBody, "srsName=\"EPSG:3857\"")
        // And the filter has to be point-in-krets, not area overlap: filtering on app:område
        // either spills whole neighbouring parcels into the list (Intersects) or silently
        // drops parcels over a sliver of survey mismatch (Within). See teigerInAreaRequest.
        assertContains(postBody, "<fes:Within>")
        assertContains(postBody, "app:representasjonspunkt")
    }

    @Test
    fun `unknown grunnkrets is 404, not 502`() = testApplication {
        val empty = """<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"/>"""
        var posts = 0
        val upstream = HttpClient(
            MockEngine { request ->
                if (request.method == HttpMethod.Post) posts++
                respond(empty, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "text/xml"))
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        // The lookup itself answered 200, so "no such grunnkrets" is distinguishable from an
        // outage — the distinction /geo/kommuner deliberately cannot make.
        assertEquals(
            HttpStatusCode.NotFound,
            client.get("/api/geo/grunnkrets-teiger?grunnkretsnummer=99999999").status,
        )
        assertEquals(0, posts)
    }

    @Test
    fun `a failing teig POST is a 502`() = testApplication {
        val upstream = HttpClient(
            MockEngine { request ->
                if (request.method == HttpMethod.Post) {
                    respondError(HttpStatusCode.InternalServerError)
                } else {
                    respond(
                        grunnkretsGml,
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, "text/xml"),
                    )
                }
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        assertEquals(
            HttpStatusCode.BadGateway,
            client.get("/api/geo/grunnkrets-teiger?grunnkretsnummer=15250101").status,
        )
    }

    @Test
    fun `rejects malformed grunnkrets params before any upstream call`() = testApplication {
        var hits = 0
        val upstream = HttpClient(
            MockEngine {
                hits++
                respond("{}", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "text/xml"))
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        for (q in listOf("abc", "1525010", "152501011", "")) {
            assertEquals(
                HttpStatusCode.BadRequest,
                client.get("/api/geo/grunnkrets-teiger?grunnkretsnummer=$q").status,
                "grunnkretsnummer=$q should be rejected",
            )
        }
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/grunnkrets-teiger").status,
        )
        // The point lookup takes whole-metre EPSG:3857 coordinates, so the same guard covers it.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/grunnkrets-punkt?ost=789919.9&nord=8938182").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/geo/grunnkrets-punkt?ost=789919").status,
        )
        assertEquals(0, hits)
    }

    // /geo/kommune-teiger-uten-mnr reduces the upstream body instead of passing it through,
    // so what it drops is the contract.

    @Test
    fun `kommune teiger uten mnr reduces features to distinct sorted lokalids`() =
        testApplication {
            val teigerGml = """
                <wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
                    xmlns:gml="http://www.opengis.net/gml/3.2">
                  <wfs:member><app:Teig xmlns:app="$TEIG_NS" gml:id="teig.292172456"/></wfs:member>
                  <wfs:member><app:Teig xmlns:app="$TEIG_NS" gml:id="teig.292171652"/></wfs:member>
                  <wfs:member><app:Teig xmlns:app="$TEIG_NS" gml:id="teig.292172456"/></wfs:member>
                </wfs:FeatureCollection>
            """.trimIndent()
            var url = ""
            val upstream = HttpClient(
                MockEngine { request ->
                    url = request.url.toString()
                    respond(
                        teigerGml,
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, "text/xml"),
                    )
                },
            )
            environment { config = MapApplicationConfig(testConfig) }
            application {
                dependencies.provide<HttpClient> { upstream }
                module()
            }

            val res = client.get("/api/geo/kommune-teiger-uten-mnr?kommunenummer=1874")
            assertEquals(HttpStatusCode.OK, res.status)
            assertEquals("[292171652,292172456]", res.bodyAsText())
            // The filter has to pin gardsnummer to 0 as well as the kommune, or this
            // returns every teig in the kommune instead of the mnr-less ones.
            assertContains(url, "gardsnummer")
            assertContains(url, "1874")
        }

    @Test
    fun `kommune teiger uten mnr answers 502 upstream and 400 on bad params`() = testApplication {
        var hits = 0
        val upstream = HttpClient(
            MockEngine {
                hits++
                respondError(HttpStatusCode.InternalServerError)
            },
        )
        environment { config = MapApplicationConfig(testConfig) }
        application {
            dependencies.provide<HttpClient> { upstream }
            module()
        }

        // A reducing route still maps every upstream failure to 502, like its neighbours.
        assertEquals(
            HttpStatusCode.BadGateway,
            client.get("/api/geo/kommune-teiger-uten-mnr?kommunenummer=1874").status,
        )
        assertEquals(1, hits)

        // kommunenummer is spliced unescaped into the FES filter, so it is guarded before
        // any upstream call — same rule as every other route here.
        val q = "/api/geo/kommune-teiger-uten-mnr"
        assertEquals(HttpStatusCode.BadRequest, client.get("$q?kommunenummer=18a4").status)
        assertEquals(HttpStatusCode.BadRequest, client.get(q).status)
        // Still 1: both requests were rejected on the parameter guard, before any fetch.
        assertEquals(1, hits)
    }
}
