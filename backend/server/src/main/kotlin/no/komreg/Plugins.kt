package no.komreg

import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.DefaultJson
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.application.log
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.CannotTransformContentToTypeException
import io.ktor.server.plugins.PayloadTooLargeException
import io.ktor.server.plugins.UnsupportedMediaTypeException
import io.ktor.server.plugins.callid.CallId
import io.ktor.server.plugins.callid.callIdMdc
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.compression.Compression
import io.ktor.server.plugins.compression.deflate
import io.ktor.server.plugins.compression.gzip
import io.ktor.server.plugins.compression.minimumSize
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.requestvalidation.RequestValidationException
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.path
import io.ktor.server.request.uri
import kotlinx.serialization.json.Json
import org.slf4j.event.Level

// Framework plugins, split out of module() so the composition root reads as a list of
// concerns. These are app-agnostic — no database or domain wiring lives here.

fun Application.configureSerialization() {
    install(ContentNegotiation) {
        // Ktor's DefaultJson plus ignoreUnknownKeys: during a rolling deploy a newer
        // frontend may send DTO fields this build doesn't know yet — drop them instead
        // of failing every save with a 400 until the fleet converges.
        json(Json(DefaultJson) { ignoreUnknownKeys = true })
    }
}

// Compress responses. This is not a micro-optimisation here: the teig GML routes relay
// megabytes each, and none of the upstream geo services send Content-Encoding, so without
// this the browser downloads every byte. That payload is repeated namespace declarations
// and decimal coordinates, which is about as compressible as text gets (measured ~8x).
//
// Applies to every route, which is what we want: /lists relays a WorkingState blob up to
// 32 MiB as well.
fun Application.configureCompression() {
    install(Compression) {
        gzip()
        deflate()
        // Below this, framing overhead and the CPU cost outweigh the saving, and small
        // JSON answers don't need it.
        minimumSize(1024)
    }
}

fun Application.configureMonitoring() {
    // Correlate all log lines of one request: take the proxy's X-Request-Id when present,
    // else generate a short id; callIdMdc puts it in the MDC (%X{call_id} in logback.xml).
    install(CallId) {
        header(HttpHeaders.XRequestId)
        // Explicit dictionary: the verifier below also applies to generated ids, and a
        // rejected id is silently dropped — so generate only chars the verifier accepts
        // (Ktor's default dictionary includes +/=).
        val dictionary = "abcdefghijklmnopqrstuvwxyz0123456789"
        generate { (1..10).map { dictionary.random() }.joinToString("") }
        // The header is client-supplied on an unauthenticated service — constrain it so
        // a crafted value can't forge log lines (newlines) or bloat them.
        verify { id -> id.length in 1..64 && id.all { it.isLetterOrDigit() || it == '-' } }
    }
    install(CallLogging) {
        level = Level.INFO
        callIdMdc("call_id")
        // Probes hit every few seconds — logging them is noise.
        filter { call -> !call.request.path().startsWith("/health") }
    }
    // Anything unhandled would otherwise surface as a bare 500 with no trace of
    // what happened — log it with the request that triggered it.
    install(StatusPages) {
        // The Throwable catch-all below bypasses Ktor's default exception→status mapping,
        // so client mistakes need their own handlers or they'd surface as 500s:
        // ContentNegotiation throws BadRequestException for a malformed body and
        // CannotTransformContentToTypeException when no converter accepts the
        // Content-Type; RequestBodyLimit throws PayloadTooLargeException for an
        // oversized body; RequestValidation throws RequestValidationException for a
        // failed body rule. This list is hand-maintained and has drifted on a Ktor
        // upgrade before — ListsApiTest pins every mapping, so run it after a bump.
        exception<BadRequestException> { call, cause ->
            // ContentNegotiation wraps whatever the body reader threw, so the exception
            // that reaches here is often not the one that matters: an oversized
            // *chunked* body arrives as BadRequestException with the real
            // PayloadTooLargeException buried in its cause chain. (The Content-Length
            // path throws PayloadTooLargeException directly and is matched below.)
            if (cause.causedBy<PayloadTooLargeException>()) {
                call.problem(HttpStatusCode.PayloadTooLarge, Kode.FOR_STOR)
            } else {
                call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL)
            }
        }
        exception<UnsupportedMediaTypeException> { call, _ ->
            call.problem(HttpStatusCode.UnsupportedMediaType, Kode.MEDIETYPE_IKKE_STOTTET)
        }
        // No registered converter could read the request's Content-Type (e.g. text/plain
        // against JSON-only negotiation). That is a 415, not a generic failure — Ktor
        // throws this, not UnsupportedMediaTypeException, for an unregistered type.
        exception<CannotTransformContentToTypeException> { call, _ ->
            call.problem(HttpStatusCode.UnsupportedMediaType, Kode.MEDIETYPE_IKKE_STOTTET)
        }
        exception<PayloadTooLargeException> { call, _ ->
            call.problem(HttpStatusCode.PayloadTooLarge, Kode.FOR_STOR)
        }
        exception<RequestValidationException> { call, cause ->
            call.problem(HttpStatusCode.BadRequest, Kode.UGYLDIG_FORESPORSEL, cause.reasons.joinToString("; "))
        }
        exception<Throwable> { call, cause ->
            call.application.log.error("Unhandled error: ${call.request.uri}", cause)
            call.problem(HttpStatusCode.InternalServerError, Kode.INTERN_FEIL)
        }
    }
}

// Walk an exception's cause chain looking for [T]. Depth-capped and self-reference
// guarded so a malformed chain can't spin here.
private inline fun <reified T : Throwable> Throwable.causedBy(): Boolean {
    var c: Throwable? = this
    var depth = 0
    while (c != null && depth++ < 10) {
        if (c is T) return true
        if (c === c.cause) break
        c = c.cause
    }
    return false
}

fun Application.configureCors() {
    // CORS is a dev-only need: the Vite dev server (:5173) calls the backend (:8080)
    // cross-origin. Prod is same-origin behind Caddy, so it stays off unless dev.cors=1
    // (application.conf substitutes DEV_CORS; docker-compose sets it in dev).
    if (environment.config.propertyOrNull("dev.cors")?.getString() != "1") return
    install(CORS) {
        anyHost()
        allowHeader(HttpHeaders.ContentType)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
    }
}
