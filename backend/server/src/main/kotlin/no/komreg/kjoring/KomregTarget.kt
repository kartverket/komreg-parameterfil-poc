package no.komreg.kjoring

import io.ktor.server.config.ApplicationConfig

/**
 * Which komreg-backend the handover points at. One choice, set at startup.
 *
 * A null [scope] means "send no token". Auth follows from the TARGET, not from a switch of
 * its own — the same rule as komreg-backend's own Bruno script
 * (`if (bru.getEnvName() !== 'local')`). A third `auth` setting would make the state "dev
 * URL, but auth still off" possible, and that mistake looks like an unexplained 401 instead
 * of a misconfiguration.
 *
 * See docs/adr/0005-komreg-backend-miljo-og-token.md.
 */
data class KomregTarget(
    val navn: String,
    val url: String,
    val scope: String?,
) {
    val kreverToken: Boolean get() = scope != null

    companion object {
        const val LOCAL = "local"
        const val DEV = "dev"

        // Deliberately NO prod: no prod URL is checked in anywhere, prod is gated by another
        // Entra group (AAD_KOMREG_PROD_USERS), and adding prod should be a deliberate change
        // with its own assessment — not one environment variable away from a laptop.
        private val GYLDIGE = listOf(LOCAL, DEV)

        /**
         * Reads the target from config. Fails at STARTUP if something is missing, in the
         * same spirit as [no.komreg.Database.Companion.fromConfig]: booting "dev" that
         * silently points at localhost is exactly the outcome worth crashing over.
         */
        fun fromConfig(config: ApplicationConfig): KomregTarget {
            fun str(key: String) =
                config.propertyOrNull("komregBackend.$key")?.getString()?.takeIf { it.isNotBlank() }

            val navn = str("target") ?: LOCAL
            check(navn in GYLDIGE) {
                "komregBackend.target (env KOMREG_TARGET) er «$navn»; gyldige er ${GYLDIGE.joinToString(", ")}"
            }

            val url = str("$navn.url")?.trimEnd('/')
            check(url != null) {
                "komregBackend.$navn.url er ikke satt (env KOMREG_${navn.uppercase()}_URL)"
            }

            if (navn == LOCAL) return KomregTarget(navn, url, scope = null)

            // The Entra client id is a public OAuth identifier, not a secret — it is checked
            // in to komreg-backend's own http/skip/http-client.env.json. The token itself is
            // the secret, and it is never stored anywhere.
            val clientId = str("$navn.clientId")
            check(clientId != null) {
                "komregBackend.$navn.clientId er ikke satt (env KOMREG_${navn.uppercase()}_CLIENT_ID)"
            }
            return KomregTarget(navn, url, scope = "$clientId/.default")
        }
    }
}
