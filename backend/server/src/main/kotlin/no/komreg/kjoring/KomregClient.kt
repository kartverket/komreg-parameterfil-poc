package no.komreg.kjoring

import io.ktor.client.HttpClient
import io.ktor.client.plugins.timeout
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import java.io.IOException
import java.nio.channels.UnresolvedAddressException

/**
 * The outcome of one call to komreg-backend.
 *
 * [reached] separates "we never got there" from "it answered, and the answer was no" — and
 * they are not the same: komreg-backend has no 400 on POST /reguleringer and wraps
 * everything, including an id that already exists, in one 500. The message is the whole
 * diagnostic.
 */
data class KomregResult(val reached: Boolean, val ok: Boolean, val status: Int?, val message: String)

/**
 * The ONLY outbound path to komreg-backend. Both the test runs in reguleringer/ and the
 * overview routes in kjoring/ go through here.
 *
 * That it is one path is the point, not tidiness: the token is attached here, so a new
 * call site cannot miss it.
 */
class KomregClient(
    private val client: HttpClient,
    val target: KomregTarget,
    /**
     * Where the token comes from. Non-null exactly when [target] requires one.
     *
     * A lambda and not an AzureCliToken: the client does not care WHERE the token comes
     * from, only that there is one. On the host it is az-cli (with caching); in a container
     * it is KOMREG_DEV_TOKEN, fetched with az on the outside. See Application.module().
     */
    private val token: (suspend () -> String)?,
) {
    // `bearer` is named rather than left as `it`: the inner request-builder lambda has a
    // receiver and no `it` of its own, so a bare `it` would silently reach out to the
    // outer lambda's. It works, and nobody should have to work that out.
    suspend fun send(payload: String): KomregResult = call { bearer ->
        client.post("${target.url}/reguleringer") {
            auth(bearer)
            contentType(ContentType.Application.Json)
            setBody(payload)
        }
    }

    suspend fun start(regId: String): KomregResult = call { bearer ->
        client.get("${target.url}/run/$regId") { auth(bearer) }
    }

    suspend fun regulations(): HttpResponse = withToken { bearer ->
        client.get("${target.url}/reguleringer") { auth(bearer) }
    }

    suspend fun running(): HttpResponse = withToken { bearer ->
        client.get("${target.url}/is-running") { auth(bearer) }
    }

    /** The target and the token state, for the environment badge in the UI. */
    suspend fun miljo(): Miljo {
        if (token == null) return Miljo(target.navn, target.url, kreverToken = false, tokenOk = true)
        return try {
            token()
            Miljo(target.navn, target.url, kreverToken = true, tokenOk = true)
        } catch (e: TokenFeil) {
            Miljo(target.navn, target.url, kreverToken = true, tokenOk = false, tokenFeil = e.message)
        }
    }

    /**
     * The token is attached HERE, per call — NEVER as a `defaultRequest`/Auth plugin on the
     * client. The HttpClient is shared with the geo proxy, so a client-wide header would
     * send a Kartverket-internal Entra token to ws.geonorge.no and api.kartverket.no on
     * every single address lookup. It is the tidiest-looking way to write this, and the
     * only dangerous one. KjoringApiTest guards it.
     *
     * The timeout is overridden at the same time: the client's global 10s is right for
     * localhost and wrong for a multi-megabyte POST over VPN — the same move as
     * LONG_UPSTREAM_TIMEOUT_MS in GeoRoutes, and for the same reason (do not raise the
     * global one).
     */
    private fun HttpRequestBuilder.auth(bearer: String?) {
        if (bearer != null) bearerAuth(bearer)
        timeout { requestTimeoutMillis = TIMEOUT_MS }
    }

    private suspend fun <T> withToken(exchange: suspend (String?) -> T): T =
        exchange(if (token != null) token() else null)

    private suspend fun call(exchange: suspend (String?) -> HttpResponse): KomregResult = try {
        val response = withToken(exchange)
        KomregResult(true, response.status.isSuccess(), response.status.value, response.bodyAsText().trim())
    } catch (e: TokenFeil) {
        // Not a network error: we never got there because we got no token. The message says
        // what to do (az login / install az), so it is passed on verbatim.
        KomregResult(false, false, null, e.message.orEmpty())
    } catch (_: IOException) {
        KomregResult(false, false, null, uteAvKontakt())
    } catch (_: UnresolvedAddressException) {
        KomregResult(false, false, null, uteAvKontakt())
    }

    private fun uteAvKontakt(): String = if (target.kreverToken) {
        // atkv3-dev is on kartverket-intern.cloud and is not publicly exposed. It is not in
        // komreg-backend's README either, so it is the most likely first stumbling block.
        "Fikk ikke kontakt med komreg-backend på ${target.url}. Er du på Kartverket-nettet (VPN/Tailscale)?"
    } else {
        "Fikk ikke kontakt med komreg-backend på ${target.url}. Kjører den?"
    }

    private companion object {
        const val TIMEOUT_MS = 60_000L
    }
}
