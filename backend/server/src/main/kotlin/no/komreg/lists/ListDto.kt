package no.komreg.lists

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// `data` is the frontend's working state, stored opaquely as JSONB.
@Serializable
data class ListSummary(val id: Int, val name: String, val createdAt: String, val updatedAt: String)

@Serializable
data class ListFull(
    val id: Int,
    val name: String,
    val createdAt: String,
    val updatedAt: String,
    val data: JsonElement,
)

@Serializable
data class SaveRequest(val name: String, val data: JsonElement)

// A PUT names the version it was edited from, so a save from a second tab or a stale page
// is refused (409) instead of silently overwriting the other one. Same rule as
// reguleringer's expectedUpdatedAt.
@Serializable
data class UpdateRequest(val name: String, val data: JsonElement, val expectedUpdatedAt: String)

// Both writes hand back the new updatedAt: it is what the client sends on its next PUT.
@Serializable
data class IdResponse(val id: Int, val updatedAt: String)

@Serializable
data class UpdatedResponse(val updatedAt: String)
