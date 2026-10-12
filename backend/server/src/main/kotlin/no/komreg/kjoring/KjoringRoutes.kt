package no.komreg.kjoring

import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.http.isSuccess
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.log
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import java.io.IOException
import java.nio.channels.UnresolvedAddressException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.komreg.Kode
import no.komreg.problem

/*
 * Read routes against komreg-backend: what is stored there, whether something is running
 * now, and which environment we point at.
 *
 * Execution is NOT here. A test run starts from its saved regulering (reguleringer/), so
 * that membership, source versions and the exact payload are journalled together — see
 * docs/adr/0004-saved-regulering-test-runs.md.
 *
 * All outbound HTTP goes through KomregClient, from here too. That is where the token is
 * attached, and a second call site would be one that forgot it.
 */

fun Route.kjoringRoutes(komreg: KomregClient) {
    route("/kjoring") {
        // Which environment we point at. The frontend shows this as a badge; it fetches it
        // from the backend instead of from a build variable, because the backend owns the
        // target and a build variable would drift from it.
        get("/miljo") { call.respond(komreg.miljo()) }

        get("/reguleringer") {
            val resp = call.hent("reguleringer") { komreg.regulations() }
                ?: return@get call.problem(HttpStatusCode.BadGateway, Kode.OPPSTROMS_UTILGJENGELIG)
            val liste = try {
                sammendrag(resp.bodyAsText())
            } catch (e: IllegalArgumentException) {
                // Not the JSON array we expected — parseToJsonElement and .jsonArray both
                // throw IllegalArgumentException. It is upstream that is odd, not the
                // caller, so 502 and not 500 via StatusPages.
                call.application.log.warn("uventet svar fra komreg-backend på /reguleringer", e)
                return@get call.problem(HttpStatusCode.BadGateway, Kode.OPPSTROMS_UTILGJENGELIG)
            }
            call.respond(liste)
        }

        get("/status") {
            val resp = call.hent("is-running") { komreg.running() }
                ?: return@get call.problem(HttpStatusCode.BadGateway, Kode.OPPSTROMS_UTILGJENGELIG)
            call.respond(StatusResponse(resp.bodyAsText().trim().toBooleanStrictOrNull() ?: false))
        }
    }
}

/**
 * One read lookup. Null = no usable overview, which becomes 502.
 *
 * Note that these two routes CAN collapse to 502, unlike send/start in KomregClient: a
 * table that could not be fetched is one state, while the difference between "500, the id
 * already exists" and "409, finished" is the whole answer. TokenFeil is caught here too, so
 * a missing az token does not become a 500 via StatusPages.
 */
private suspend fun ApplicationCall.hent(
    hva: String,
    exchange: suspend () -> HttpResponse,
): HttpResponse? {
    val resp = try {
        exchange()
    } catch (e: TokenFeil) {
        application.log.warn("token mangler for komreg-backend ($hva): ${e.message}")
        return null
    } catch (e: IOException) {
        // The client's timeouts (HttpRequestTimeoutException, ConnectTimeoutException)
        // also extend IOException, so they end up here.
        application.log.warn("nådde ikke komreg-backend for $hva", e)
        return null
    } catch (e: UnresolvedAddressException) {
        // A DNS failure in the CIO client extends IllegalArgumentException, not IOException.
        application.log.warn("DNS-oppslag mot komreg-backend feilet for $hva", e)
        return null
    }
    if (!resp.status.isSuccess()) {
        application.log.warn("komreg-backend svarte {} på {}", resp.status, hva)
        return null
    }
    return resp
}

/**
 * GET /reguleringer over there returns every regulering in full, and a large kjøring is
 * tens of thousands of transformasjoner. We count them here and discard the rest. The
 * counting is free: the body is already parsed, and the alternative is sending tens of
 * thousands of objects to the browser for it to do the same.
 *
 * `type` is kotlinx's class discriminator on TransformasjonDTO, not a field we invent —
 * see the sealed class in regulering/ReguleringDto.kt. An unknown type is counted under its
 * own name instead of disappearing; it then shows up in the UI the day it exists.
 *
 * Throws IllegalArgumentException on anything but the expected array.
 */
private fun sammendrag(body: String): List<ReguleringSammendrag> =
    Json.parseToJsonElement(body).jsonArray.map { element ->
        val o = element.jsonObject
        val endringer = o["endringer"]?.jsonArray.orEmpty()
        // eachCount() gives a LinkedHashMap, so the order is the payload's own
        // (matrikkelenhet -> teig -> veg -> vegadresse) and not random between calls.
        val perType = endringer
            .flatMap { it.jsonObject["transformasjoner"]?.jsonArray.orEmpty() }
            .groupingBy { it.jsonObject["type"]?.jsonPrimitive?.content ?: "ukjent" }
            .eachCount()
        ReguleringSammendrag(
            id = o["id"]?.jsonPrimitive?.content ?: "",
            navn = o["navn"]?.jsonPrimitive?.content ?: "",
            dato = o["dato"]?.jsonPrimitive?.content ?: "",
            antallEndringer = endringer.size,
            antallTransformasjoner = perType.values.sum(),
            transformasjonerPerType = perType,
        )
    }
