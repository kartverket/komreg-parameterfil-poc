package no.komreg.reguleringer

import java.util.UUID
import no.komreg.kjoring.KomregClient
import no.komreg.kjoring.KomregResult
import no.komreg.regulering.GenererRequest
import no.komreg.regulering.UgyldigReguleringException
import no.komreg.regulering.genererFiler
import no.komreg.regulering.validerMetadata

/*
 * Starting a test run is the one action in this slice that does more than read or write a
 * single row: it validates, builds the payload, journals, sends and starts — with a status
 * write between each step. The order is what matters, and it belongs here and not in an
 * HTTP handler, the same way genererFiler lives in regulering/ReguleringService.kt and not
 * in its route.
 *
 * docs/adr/0004-saved-regulering-test-runs.md (from the repository root)
 */

/**
 * The outcome of an attempt to start a test run, in the shape the route can map straight to
 * an HTTP status. A sealed interface and not exceptions: "the regulering has changed" and
 * "komreg is already running" are normal answers here, not failures.
 */
sealed interface TestkjoringUtfall {
    /** The request is invalid as it stands → 400. */
    data class Ugyldig(val melding: String) : TestkjoringUtfall

    /** The regulering does not exist → 404. */
    data object FinnesIkke : TestkjoringUtfall

    /** Something changed under the client, or it is already running → 409. */
    data class Konflikt(val melding: String) : TestkjoringUtfall

    /**
     * The attempt was journalled and carried out as far as it got → 200 with [run].
     *
     * Note that this does NOT mean the kjøring went well: a rejected send or start is also
     * a completed attempt, and the status on [run] is the answer. Only what was never
     * journalled is anything other than 200.
     */
    data class Utfort(val run: TestRunSummary) : TestkjoringUtfall
}

/**
 * Journal and run one test run against komreg-backend.
 *
 * The order of the steps is deliberate:
 *  1. validate the request and build the payload FIRST — an invalid request should not cost
 *     a call to komreg-backend
 *  2. create the row BEFORE we send, so the payload that went out is stored whatever happens
 *     to the network afterwards
 */
suspend fun kjorTestkjoring(
    repo: ReguleringerRepository,
    komreg: KomregClient,
    reguleringId: Int,
    body: StartTestRunRequest,
): TestkjoringUtfall {
    feilMiljo(komreg, body.expectedKomregUrl)?.let { return it }
    if (body.sources.isEmpty() || body.sources.distinctBy { it.listId }.size != body.sources.size) {
        return TestkjoringUtfall.Ugyldig("Velg minst én unik grensejustering.")
    }
    val regulering = repo.find(reguleringId) ?: return TestkjoringUtfall.FinnesIkke

    // One single-use id per attempt. komreg-backend's regulering.id is the primary key and
    // the handler is a plain INSERT, so a reused id comes back as a generic 500 — see the
    // README. Hence a fresh id per kjøring, not the regulering's own.
    val externalId = "${regulering.baseId}-t-${UUID.randomUUID().toString().replace("-", "").take(12)}"

    val request = GenererRequest(externalId, regulering.navn, regulering.dato, body.rader)
    val metadataFeil = validerMetadata(request)
    if (metadataFeil.isNotEmpty()) {
        return TestkjoringUtfall.Ugyldig(metadataFeil.joinToString("; "))
    }
    val generert = try {
        genererFiler(request)
    } catch (e: UgyldigReguleringException) {
        return TestkjoringUtfall.Ugyldig(e.feil.joinToString("; "))
    }

    // No /is-running guard here, on purpose. It used to be here on the assumption that
    // komreg-backend takes one kjøring at a time; it does not. The guard over there is PER
    // regulering (ReguleringService.getOrThrowRegulering throws ReguleringAlreadyRunning
    // only when that very regId has a KJØRER kjøring), and since we mint a fresh externalId
    // per test run it can never hit us. /is-running is global and also counts
    // IKKE_TILBAKEFØRT — a resting state, not a kjøring in progress — so it stays `true`
    // forever after one test run nobody has rolled back. It is made to gate a DEPLOY (see
    // check-is-komreg-dev-running.yml over there), not a kjøring. The result was a
    // permanently grey Kjør button. See docs/adr/0004.

    // Every reason for null here — archived, changed, a source list that is not a member or
    // has changed — becomes one message: none of them can be fixed without reloading the page.
    var run = repo.createRun(
        reguleringId = reguleringId,
        expectedUpdatedAt = body.expectedReguleringUpdatedAt,
        sources = body.sources,
        externalId = externalId,
        payload = generert.samlet.json,
    ) ?: return TestkjoringUtfall.Konflikt(
        "Reguleringen eller en valgt grensejustering er endret. Last siden på nytt.",
    )

    val sendt = komreg.send(generert.samlet.json)
    run = repo.updateRun(run.id, sendStatus(sendt), RunPhase.SEND, sendt.status, sendt.message)
    // If the payload did not arrive, there is nothing to start. The row carries the outcome.
    // If the client only asked to send, we stop here too: the row stays in `sent` and is
    // started on its own, with [startSendtKjoring].
    if (!sendt.ok || !body.start) return TestkjoringUtfall.Utfort(run)

    // Automatic and manual starts share the same claim, so only one can reach /run.
    return startSendtKjoring(repo, komreg, reguleringId, run.id, body.expectedKomregUrl)
}

/**
 * The client names the komreg-backend its user confirmed, and we refuse when that is not
 * where this process points. Checked before anything is journalled or claimed, so a refusal
 * costs nothing: no row, and a `sent` kjøring keeps its one start.
 */
private fun feilMiljo(komreg: KomregClient, expectedKomregUrl: String): TestkjoringUtfall.Konflikt? {
    val target = komreg.target
    if (expectedKomregUrl == target.url) return null
    return TestkjoringUtfall.Konflikt(
        "Backend peker nå mot ${target.navn.uppercase()} (${target.url}), ikke dit du bekreftet. Prøv igjen.",
    )
}

/**
 * Start a kjøring that is already in komreg-backend (status `sent`). No new payload and no
 * new id: what is started is exactly what was sent and journalled.
 *
 * The row is taken with [ReguleringerRepository.claimStart] BEFORE the call, so two
 * simultaneous attempts cannot both reach /run. The `updatedAt` of the regulering and the
 * lists is deliberately not checked here — those guarded what was sent, and that is done.
 * If a list has changed since, the history shows it.
 */
suspend fun startSendtKjoring(
    repo: ReguleringerRepository,
    komreg: KomregClient,
    reguleringId: Int,
    runId: Long,
    expectedKomregUrl: String,
): TestkjoringUtfall {
    feilMiljo(komreg, expectedKomregUrl)?.let { return it }
    val run = repo.claimStart(reguleringId, runId)
        ?: return if (repo.run(reguleringId, runId) == null) {
            TestkjoringUtfall.FinnesIkke
        } else {
            TestkjoringUtfall.Konflikt("Bare en sendt kjøring som ikke er startet kan startes. Last siden på nytt.")
        }
    val startet = komreg.start(run.externalId)
    return TestkjoringUtfall.Utfort(
        repo.updateRun(run.id, startStatus(startet), RunPhase.START, startet.status, startet.message),
    )
}

/*
 * The two status names below separate "we never got there" from "it answered, and the
 * answer was no" — KomregResult.reached. That distinction is the whole point of storing the
 * outcome: a *_unknown attempt may have arrived anyway, so it is the one case nobody should
 * rerun without checking in komreg-backend first. The strings must match the CHECK
 * constraint in V3__saved_reguleringer.sql.
 */

private fun sendStatus(result: KomregResult): String = when {
    !result.reached -> "send_unknown"
    !result.ok -> "send_rejected"
    else -> "sent"
}

private fun startStatus(result: KomregResult): String = when {
    !result.reached -> "start_unknown"
    !result.ok -> "start_rejected"
    else -> "start_accepted"
}
