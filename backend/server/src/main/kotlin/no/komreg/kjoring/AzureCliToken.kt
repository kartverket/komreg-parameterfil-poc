package no.komreg.kjoring

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory

/** The token could not be fetched. [melding] is written to be shown in the UI — say what to do. */
class TokenFeil(melding: String, cause: Throwable? = null) : Exception(melding, cause)

/**
 * Entra token for komreg-backend in dev, fetched with az-cli.
 *
 * This is a direct port of the flow that already works — komreg-backend's Bruno script
 * runs exactly the same command, with exactly the same 50-minute cache. That leaves one
 * way to get a token, and it is the documented one (komreg-backend README,
 * "Tilgangsstyring").
 *
 * The token is a DELEGATED user token — your own. That is right here: authorization is by
 * Entra group membership (AAD_TF_TEAM_SMIA for atkv3-dev), and komreg-backend should record
 * who actually ran the regulering, not a shared robot.
 *
 * The token is NEVER logged, and never written to a file — az owns its own refresh token.
 */
class AzureCliToken(
    private val scope: String,
    // Replaceable in tests: makes the caching testable without az installed.
    private val hent: suspend (String) -> String = ::azAccountGetAccessToken,
) {
    private val mutex = Mutex()
    private var token: String? = null
    private var hentetVed = 0L

    /**
     * The cached token, fetched again when it is older than [TTL_MS].
     *
     * The mutex is not decoration: /kjoring/miljo, /kjoring/reguleringer and /kjoring/status
     * fire at the same time when the page loads, and without it that would be three az
     * processes.
     */
    suspend fun token(): String {
        mutex.withLock {
            val naa = System.currentTimeMillis()
            val gjeldende = token
            if (gjeldende != null && naa - hentetVed < TTL_MS) return gjeldende
            val nytt = hent(scope)
            token = nytt
            hentetVed = naa
            log.info("hentet nytt Entra-token for komreg-backend (gjenbrukes i {} min)", TTL_MS / 60_000)
            return nytt
        }
    }

    companion object {
        // The same threshold as the Bruno script, chosen against Entra's ~60 minute lifetime.
        private const val TTL_MS = 50L * 60 * 1000
        private val log = LoggerFactory.getLogger(AzureCliToken::class.java)
    }
}

private const val AZ_TIMEOUT_SEKUNDER = 30L

/**
 * `az account get-access-token --scope <scope> --query accessToken -o tsv`
 *
 * The failures are classified because they have different fixes and all three will happen.
 */
internal suspend fun azAccountGetAccessToken(scope: String): String = withContext(Dispatchers.IO) {
    val prosess = try {
        ProcessBuilder(
            "az", "account", "get-access-token",
            "--scope", scope,
            "--query", "accessToken",
            "-o", "tsv",
        ).start()
    } catch (e: java.io.IOException) {
        // az is not on PATH. Its own message: telling someone to run `az login` when az is
        // not installed sends them the wrong way.
        throw TokenFeil(
            "Fant ikke Azure CLI (az) på PATH. Installer az-cli og kjør «az login --allow-no-subscriptions».",
            e,
        )
    }

    // Read the streams BEFORE waitFor: a full pipe buffer would otherwise block the process.
    val ut = prosess.inputStream.bufferedReader().readText().trim()
    val feil = prosess.errorStream.bufferedReader().readText().trim()

    if (!prosess.waitFor(AZ_TIMEOUT_SEKUNDER, TimeUnit.SECONDS)) {
        prosess.destroyForcibly()
        throw TokenFeil("az svarte ikke innen $AZ_TIMEOUT_SEKUNDER sekunder.")
    }
    if (prosess.exitValue() != 0) {
        // az says "Please run 'az login'" both when not logged in and on an expired refresh token.
        if (feil.contains("az login", ignoreCase = true)) {
            throw TokenFeil("Ikke innlogget i Azure. Kjør «az login --allow-no-subscriptions».")
        }
        // The first line of stderr: the rest is usually a stack trace from az itself.
        throw TokenFeil("az feilet: ${feil.lineSequence().firstOrNull().orEmpty().ifBlank { "ukjent feil" }}")
    }
    if (ut.isBlank()) throw TokenFeil("az svarte uten token.")
    ut
}
