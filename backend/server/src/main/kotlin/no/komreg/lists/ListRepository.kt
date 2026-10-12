package no.komreg.lists

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import no.komreg.Database

// Data access for the `lists` table. The `data` column is the frontend's working state,
// stored opaquely as JSONB — read and written verbatim, never interpreted here.
class ListRepository(private val db: Database) {
    suspend fun all(): List<ListSummary> = db.withConnection { c ->
        c.prepareStatement(
            "SELECT id, name, created_at::text, updated_at::text FROM lists ORDER BY updated_at DESC",
        ).use { ps ->
            ps.executeQuery().use { rs ->
                val all = ArrayList<ListSummary>()
                while (rs.next()) {
                    all.add(
                        ListSummary(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getString(4)),
                    )
                }
                all
            }
        }
    }

    suspend fun create(name: String, data: JsonElement): IdResponse = db.withConnection { c ->
        c.prepareStatement(
            "INSERT INTO lists(name, data) VALUES (?, ?::jsonb) RETURNING id, updated_at::text",
        ).use { ps ->
            ps.setString(1, name)
            ps.setString(2, data.toString())
            // RETURNING id always yields a row; treating its absence as id -1 would
            // serve a 201 Created for a list that can never be fetched again.
            ps.executeQuery().use { rs ->
                check(rs.next()) { "INSERT INTO lists returned no id" }
                IdResponse(rs.getInt(1), rs.getString(2))
            }
        }
    }

    suspend fun find(id: Int): ListFull? = db.withConnection { c ->
        c.prepareStatement(
            "SELECT id, name, created_at::text, updated_at::text, data::text FROM lists WHERE id = ?",
        ).use { ps ->
            ps.setInt(1, id)
            ps.executeQuery().use { rs ->
                if (rs.next()) {
                    ListFull(
                        rs.getInt(1),
                        rs.getString(2),
                        rs.getString(3),
                        rs.getString(4),
                        Json.parseToJsonElement(rs.getString(5)),
                    )
                } else {
                    null
                }
            }
        }
    }

    // The version check is in the UPDATE's own WHERE, not a read before it: two saves that
    // both read the same updated_at would otherwise both pass. Null means no row matched —
    // the route tells "gone" from "changed" with exists(), after the fact.
    suspend fun update(id: Int, name: String, data: JsonElement, expectedUpdatedAt: String): String? =
        db.withConnection { c ->
            c.prepareStatement(
                "UPDATE lists SET name = ?, data = ?::jsonb, updated_at = now() " +
                    "WHERE id = ? AND updated_at::text = ? RETURNING updated_at::text",
            ).use { ps ->
                ps.setString(1, name)
                ps.setString(2, data.toString())
                ps.setInt(3, id)
                ps.setString(4, expectedUpdatedAt)
                ps.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
            }
        }

    suspend fun exists(id: Int): Boolean = db.withConnection { c ->
        c.prepareStatement("SELECT 1 FROM lists WHERE id = ?").use { ps ->
            ps.setInt(1, id)
            ps.executeQuery().use { it.next() }
        }
    }

    suspend fun delete(id: Int): Boolean = db.withConnection { c ->
        c.prepareStatement("DELETE FROM lists WHERE id = ?").use { ps ->
            ps.setInt(1, id)
            ps.executeUpdate() > 0
        }
    }
}
