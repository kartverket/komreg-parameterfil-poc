package no.komreg.reguleringer

import kotlinx.serialization.Serializable
import no.komreg.regulering.RadDTO

@Serializable
data class ReguleringSummary(
    val id: Int,
    val baseId: String,
    val navn: String,
    val dato: String,
    val listCount: Int,
    val archivedAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val latestRunStatus: String? = null,
)

@Serializable
data class ReguleringDetail(
    val id: Int,
    val baseId: String,
    val navn: String,
    val dato: String,
    val listIds: List<Int>,
    val archivedAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class SaveReguleringRequest(
    // Left out by the frontend — nobody is asked to type a base id. The route mints one from
    // the name when the field is missing; see genererBaseId in ReguleringerRoutes.
    val baseId: String? = null,
    val navn: String,
    val dato: String,
    val listIds: List<Int> = emptyList(),
    val expectedUpdatedAt: String? = null,
)

@Serializable data class ReguleringIdResponse(val id: Int)

@Serializable
data class RunSource(val listId: Int, val name: String, val updatedAt: String)

@Serializable
data class StartTestRunRequest(
    // The komreg-backend url the user was shown in the confirm. Required, and refused when
    // it is not the one this process points at: the target follows the backend, so a page
    // left open across a restart would otherwise send somewhere else than it said.
    val expectedKomregUrl: String,
    val expectedReguleringUpdatedAt: String,
    val sources: List<RunSource>,
    val rader: List<RadDTO>,
    // false = send only: the regulering is put in komreg-backend's database and the row
    // stays in `sent`, ready for a start of its own. Defaults to true, so a client that does
    // not know the field gets send-and-start.
    val start: Boolean = true,
)

/** Body of the separate start. Same check as [StartTestRunRequest.expectedKomregUrl]. */
@Serializable
data class StartSentRunRequest(val expectedKomregUrl: String)

@Serializable
data class TestRunSummary(
    val id: Long,
    val externalId: String,
    val status: String,
    val sources: List<RunSource>,
    val sendStatus: Int? = null,
    val sendMessage: String? = null,
    val startStatus: Int? = null,
    val startMessage: String? = null,
    val createdAt: String,
    val updatedAt: String,
)
