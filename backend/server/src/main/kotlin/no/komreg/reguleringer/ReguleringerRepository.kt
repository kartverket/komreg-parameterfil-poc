package no.komreg.reguleringer

import java.sql.Connection
import java.sql.ResultSet
import java.sql.Types
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import no.komreg.Database
import no.komreg.transaction

/**
 * Which half of a test run a result belongs to. An enum and not a string because the phase
 * picks a pair of columns in the SQL: a string would have to be interpolated into the
 * statement, and an identifier coming from outside has no place in a query.
 */
enum class RunPhase { SEND, START }

// The columns of a test-run row, without `payload`. That is the whole parameterfil —
// several megabytes per row — and none of the readers here use it, so `SELECT *` meant the
// whole history was pulled out of the database to be thrown away. The payload is fetched
// on its own in [ReguleringerRepository.payload], the one that actually wants it.
//
// Explicit aliases on the ::text casts, so the row reading below can go by name: a renamed
// or moved column becomes an error in the query instead of a wrong value.
private const val RUN_COLUMNS =
    "id, external_id, status, source_snapshot::text AS source_snapshot, " +
        "send_status, send_message, start_status, start_message, " +
        "created_at::text AS created_at, updated_at::text AS updated_at"

class ReguleringerRepository(private val db: Database) {

    suspend fun all(includeArchived: Boolean): List<ReguleringSummary> = db.withConnection { c ->
        c.prepareStatement(
            """
            SELECT r.id, r.base_id, r.navn, r.dato::text AS dato,
                   count(DISTINCT rl.list_id)::int AS list_count,
                   r.archived_at::text AS archived_at,
                   r.created_at::text AS created_at,
                   r.updated_at::text AS updated_at,
                   (SELECT t.status FROM regulering_testkjoringer t
                    WHERE t.regulering_id = r.id
                    ORDER BY t.created_at DESC LIMIT 1) AS latest_run_status
            FROM reguleringer r
            LEFT JOIN regulering_lister rl ON rl.regulering_id = r.id
            WHERE (? OR r.archived_at IS NULL)
            GROUP BY r.id
            ORDER BY r.updated_at DESC
            """.trimIndent(),
        ).use { ps ->
            ps.setBoolean(1, includeArchived)
            ps.executeQuery().use { rs ->
                buildList { while (rs.next()) add(rs.toSummary()) }
            }
        }
    }

    suspend fun find(id: Int): ReguleringDetail? = db.withConnection { c -> find(c, id) }

    suspend fun create(req: SaveReguleringRequest): Int = db.withConnection { c ->
        c.transaction {
            val id = c.prepareStatement(
                "INSERT INTO reguleringer(base_id, navn, dato) VALUES (?, ?, ?::date) RETURNING id",
            ).use { ps ->
                ps.setString(1, req.baseId)
                ps.setString(2, req.navn)
                ps.setString(3, req.dato)
                // RETURNING id always yields a row; the same reasoning as ListRepository.create
                // — a missing id here would mean answering 201 for something unfetchable.
                ps.executeQuery().use { rs ->
                    check(rs.next()) { "INSERT INTO reguleringer returned no id" }
                    rs.getInt(1)
                }
            }
            replaceLists(c, id, req.listIds)
            id
        }
    }

    /**
     * Optimistic locking: `null` = does not exist, `false` = archived or changed by someone
     * else since the client read it, `true` = updated.
     *
     * `updated_at` is checked twice on purpose — first against the row that was read, then
     * once more in the WHERE of the UPDATE itself. The read alone is a TOCTOU window: two
     * simultaneous PUTs can both read the same `updated_at` and both get past. The statement
     * is what actually decides, and zero updated rows means the other one got there first.
     */
    suspend fun update(id: Int, req: SaveReguleringRequest): Boolean? = db.withConnection { c ->
        c.transaction {
            val existing = find(c, id) ?: return@transaction null
            if (existing.archivedAt != null || req.expectedUpdatedAt != existing.updatedAt) {
                return@transaction false
            }
            val updated = c.prepareStatement(
                """
                UPDATE reguleringer SET base_id = ?, navn = ?, dato = ?::date, updated_at = now()
                WHERE id = ? AND updated_at::text = ?
                """.trimIndent(),
            ).use { ps ->
                ps.setString(1, req.baseId)
                ps.setString(2, req.navn)
                ps.setString(3, req.dato)
                ps.setInt(4, id)
                ps.setString(5, req.expectedUpdatedAt)
                ps.executeUpdate()
            }
            if (updated == 0) return@transaction false
            replaceLists(c, id, req.listIds)
            true
        }
    }

    // Idempotent in both directions: archiving something already archived hits no row and
    // answers false, which the route turns into 404. That is deliberate — the button should
    // not look like it worked when the state was different from what the page showed.
    suspend fun setArchived(id: Int, archived: Boolean): Boolean = db.withConnection { c ->
        val sql = if (archived) {
            "UPDATE reguleringer SET archived_at = now(), updated_at = now() " +
                "WHERE id = ? AND archived_at IS NULL"
        } else {
            "UPDATE reguleringer SET archived_at = NULL, updated_at = now() " +
                "WHERE id = ? AND archived_at IS NOT NULL"
        }
        c.prepareStatement(sql).use { ps ->
            ps.setInt(1, id)
            ps.executeUpdate() > 0
        }
    }

    /**
     * The name of every regulering that uses this grensejustering. An empty list = none,
     * and then the list can be deleted; otherwise the names are what ListRoutes shows in
     * the refusal. `regulering_lister.list_id` has ON DELETE RESTRICT, so this is the
     * explanation of an error the database would give anyway — only readable.
     */
    suspend fun blockersForList(listId: Int): List<String> = db.withConnection { c ->
        c.prepareStatement(
            """
            SELECT r.navn FROM reguleringer r
            JOIN regulering_lister rl ON rl.regulering_id = r.id
            WHERE rl.list_id = ? ORDER BY r.navn
            """.trimIndent(),
        ).use { ps ->
            ps.setInt(1, listId)
            ps.executeQuery().use { rs ->
                buildList { while (rs.next()) add(rs.getString(1)) }
            }
        }
    }

    /**
     * Forced delete: take the grensejustering out of every regulering that uses it, and
     * delete it, in one transaction — otherwise the membership could go while the list
     * stayed. Archived reguleringer are included; they cannot be edited, so this is the
     * only way out for them.
     *
     * `updated_at` is moved on the reguleringer that lose a member, so an open tab with the
     * old member list gets 409 on its next save instead of putting the list back. The test
     * runs are untouched: they point at the regulering and have their own source snapshot.
     */
    suspend fun slettListeMedMedlemskap(listId: Int): Boolean = db.withConnection { c ->
        c.transaction {
            c.prepareStatement(
                """
                UPDATE reguleringer SET updated_at = now()
                WHERE id IN (SELECT regulering_id FROM regulering_lister WHERE list_id = ?)
                """.trimIndent(),
            ).use { ps ->
                ps.setInt(1, listId)
                ps.executeUpdate()
            }
            c.prepareStatement("DELETE FROM regulering_lister WHERE list_id = ?").use { ps ->
                ps.setInt(1, listId)
                ps.executeUpdate()
            }
            c.prepareStatement("DELETE FROM lists WHERE id = ?").use { ps ->
                ps.setInt(1, listId)
                ps.executeUpdate() > 0
            }
        }
    }

    /**
     * Journal a test run before it is sent: which sources it covered and exactly which
     * payload went out. `null` = the request is no longer valid, and the route turns every
     * reason into one 409 — none of them is something the client can fix other than by
     * reloading the page.
     *
     * Everything is checked inside the transaction, against the database and not against
     * what the client sent:
     *  - the regulering exists, is not archived, and has not changed since the client read it
     *  - the sources are a non-empty subset of the regulering's members — otherwise a
     *    kjøring could drag along a list that was never added to it
     *  - every source list still has the same name AND the same updated_at. The name is
     *    included because it is in the filename and in the journal: a kjøring labelled with
     *    a name the list no longer has is worse than a refused kjøring.
     */
    suspend fun createRun(
        reguleringId: Int,
        expectedUpdatedAt: String,
        sources: List<RunSource>,
        externalId: String,
        payload: String,
    ): TestRunSummary? = db.withConnection { c ->
        c.transaction {
            // Serialize membership edits and archiving with validation. The aggregate in
            // find() cannot carry a row lock, so lock its parent first and then reread it.
            val exists = c.prepareStatement("SELECT id FROM reguleringer WHERE id = ? FOR UPDATE").use { ps ->
                ps.setInt(1, reguleringId)
                ps.executeQuery().use { it.next() }
            }
            if (!exists) return@transaction null
            val regulering = find(c, reguleringId) ?: return@transaction null
            if (regulering.archivedAt != null || regulering.updatedAt != expectedUpdatedAt) {
                return@transaction null
            }
            val sourceIds = sources.map { it.listId }.toSet()
            if (sourceIds.isEmpty() || !regulering.listIds.containsAll(sourceIds)) {
                return@transaction null
            }
            // Share locks also block non-key edits (name/data/version), unlike KEY SHARE.
            // Keep them until journalling commits, and acquire them in a stable order.
            for (source in sources.sortedBy { it.listId }) {
                if (!listStillMatches(c, source)) return@transaction null
            }
            c.prepareStatement(
                """
                INSERT INTO regulering_testkjoringer
                    (regulering_id, external_id, status, source_snapshot, payload)
                VALUES (?, ?, 'prepared', ?::jsonb, ?)
                RETURNING $RUN_COLUMNS
                """.trimIndent(),
            ).use { ps ->
                ps.setInt(1, reguleringId)
                ps.setString(2, externalId)
                ps.setString(3, Json.encodeToString(sources))
                ps.setString(4, payload)
                ps.executeQuery().use { rs ->
                    check(rs.next()) { "INSERT INTO regulering_testkjoringer returned no row" }
                    rs.toRunSummary()
                }
            }
        }
    }

    /**
     * Write the outcome of one half of the kjøring back onto the row, and return the row as
     * it now stands — in the same round trip, so there is no window where the caller holds
     * an old copy.
     *
     * The two statements are written out in full instead of building the column name from
     * [phase]. The duplication is cheaper than an identifier assembled in code.
     */
    suspend fun updateRun(
        id: Long,
        status: String,
        phase: RunPhase,
        code: Int?,
        message: String?,
    ): TestRunSummary = db.withConnection { c ->
        val sql = when (phase) {
            RunPhase.SEND ->
                "UPDATE regulering_testkjoringer " +
                    "SET status = ?, send_status = ?, send_message = ?, updated_at = now() " +
                    "WHERE id = ? RETURNING $RUN_COLUMNS"
            RunPhase.START ->
                "UPDATE regulering_testkjoringer " +
                    "SET status = ?, start_status = ?, start_message = ?, updated_at = now() " +
                    "WHERE id = ? RETURNING $RUN_COLUMNS"
        }
        c.prepareStatement(sql).use { ps ->
            ps.setString(1, status)
            if (code == null) ps.setNull(2, Types.INTEGER) else ps.setInt(2, code)
            ps.setString(3, message)
            ps.setLong(4, id)
            ps.executeQuery().use { rs ->
                // The row was created a few lines earlier in the same request. If we get
                // here without a row the update has silently not happened, and then the
                // answer to "how did the kjøring go" is not something to guess at.
                check(rs.next()) { "testkjøring $id fantes ikke ved oppdatering av $phase" }
                rs.toRunSummary()
            }
        }
    }

    /**
     * Claim a sent kjøring in order to start it: `sent` → `start_unknown` in one statement,
     * before the call to komreg-backend. Null means the row does not exist or is not in
     * `sent`.
     *
     * The transition IS the guard. A double click or two tabs both see "sent" if they read
     * first, and /run is irreversible; with the condition in the UPDATE's own WHERE only one
     * wins. `start_unknown` is also the true status while the call is in flight — if the
     * process dies before the answer arrives, the row is left as the one thing nobody should
     * rerun without checking.
     */
    suspend fun claimStart(reguleringId: Int, runId: Long): TestRunSummary? = db.withConnection { c ->
        c.prepareStatement(
            "UPDATE regulering_testkjoringer SET status = 'start_unknown', updated_at = now() " +
                "WHERE id = ? AND regulering_id = ? AND status = 'sent' RETURNING $RUN_COLUMNS",
        ).use { ps ->
            ps.setLong(1, runId)
            ps.setInt(2, reguleringId)
            ps.executeQuery().use { rs -> if (rs.next()) rs.toRunSummary() else null }
        }
    }

    suspend fun run(reguleringId: Int, runId: Long): TestRunSummary? = db.withConnection { c ->
        c.prepareStatement(
            "SELECT $RUN_COLUMNS FROM regulering_testkjoringer WHERE id = ? AND regulering_id = ?",
        ).use { ps ->
            ps.setLong(1, runId)
            ps.setInt(2, reguleringId)
            ps.executeQuery().use { rs -> if (rs.next()) rs.toRunSummary() else null }
        }
    }

    suspend fun runs(reguleringId: Int): List<TestRunSummary> = db.withConnection { c ->
        c.prepareStatement(
            // t.created_at, not created_at: RUN_COLUMNS outputs created_at as TEXT, and a
            // bare column in ORDER BY binds to the output name first. The rows would then be
            // sorted lexicographically on the timestamp string — which breaks on differing
            // numbers of decimals and across a daylight-saving change. Qualified, it binds
            // to the column.
            "SELECT $RUN_COLUMNS FROM regulering_testkjoringer t " +
                "WHERE t.regulering_id = ? ORDER BY t.created_at DESC",
        ).use { ps ->
            ps.setInt(1, reguleringId)
            ps.executeQuery().use { rs ->
                buildList { while (rs.next()) add(rs.toRunSummary()) }
            }
        }
    }

    /** external_id (the filename) and the stored payload, or null if the kjøring does not exist. */
    suspend fun payload(reguleringId: Int, runId: Long): Pair<String, String>? = db.withConnection { c ->
        c.prepareStatement(
            "SELECT external_id, payload FROM regulering_testkjoringer " +
                "WHERE id = ? AND regulering_id = ?",
        ).use { ps ->
            ps.setLong(1, runId)
            ps.setInt(2, reguleringId)
            ps.executeQuery().use { rs ->
                if (rs.next()) rs.getString("external_id") to rs.getString("payload") else null
            }
        }
    }

    // --- Internal -------------------------------------------------------------------

    private fun find(c: Connection, id: Int): ReguleringDetail? = c.prepareStatement(
        """
        SELECT r.id, r.base_id, r.navn, r.dato::text AS dato,
               r.archived_at::text AS archived_at,
               r.created_at::text AS created_at,
               r.updated_at::text AS updated_at,
               coalesce(
                   array_agg(rl.list_id ORDER BY rl.list_id) FILTER (WHERE rl.list_id IS NOT NULL),
                   '{}'
               ) AS list_ids
        FROM reguleringer r
        LEFT JOIN regulering_lister rl ON rl.regulering_id = r.id
        WHERE r.id = ? GROUP BY r.id
        """.trimIndent(),
    ).use { ps ->
        ps.setInt(1, id)
        ps.executeQuery().use { rs -> if (rs.next()) rs.toDetail() else null }
    }

    /** Does the source list still have the name and version the client saw when it picked it? */
    private fun listStillMatches(c: Connection, source: RunSource): Boolean =
        c.prepareStatement("SELECT name, updated_at::text AS updated_at FROM lists WHERE id = ? FOR SHARE").use { ps ->
            ps.setInt(1, source.listId)
            ps.executeQuery().use { rs ->
                rs.next() &&
                    rs.getString("name") == source.name &&
                    rs.getString("updated_at") == source.updatedAt
            }
        }

    // The membership is set, not merged: a PUT sends the whole list, so what is not in it
    // goes. distinct() because the primary key (regulering_id, list_id) would otherwise
    // reject a duplicated id in the request as a database error.
    private fun replaceLists(c: Connection, id: Int, listIds: List<Int>) {
        c.prepareStatement("DELETE FROM regulering_lister WHERE regulering_id = ?").use { ps ->
            ps.setInt(1, id)
            ps.executeUpdate()
        }
        c.prepareStatement(
            "INSERT INTO regulering_lister(regulering_id, list_id) VALUES (?, ?)",
        ).use { ps ->
            for (listId in listIds.distinct()) {
                ps.setInt(1, id)
                ps.setInt(2, listId)
                ps.addBatch()
            }
            ps.executeBatch()
        }
    }

    private fun ResultSet.toSummary() = ReguleringSummary(
        id = getInt("id"),
        baseId = getString("base_id"),
        navn = getString("navn"),
        dato = getString("dato"),
        listCount = getInt("list_count"),
        archivedAt = getString("archived_at"),
        createdAt = getString("created_at"),
        updatedAt = getString("updated_at"),
        latestRunStatus = getString("latest_run_status"),
    )

    private fun ResultSet.toDetail() = ReguleringDetail(
        id = getInt("id"),
        baseId = getString("base_id"),
        navn = getString("navn"),
        dato = getString("dato"),
        listIds = (getArray("list_ids").array as Array<*>).map { (it as Number).toInt() },
        archivedAt = getString("archived_at"),
        createdAt = getString("created_at"),
        updatedAt = getString("updated_at"),
    )

    private fun ResultSet.toRunSummary() = TestRunSummary(
        id = getLong("id"),
        externalId = getString("external_id"),
        status = getString("status"),
        sources = Json.decodeFromString(getString("source_snapshot")),
        // getObject, not getInt: send_status/start_status are NULL until that phase has
        // actually happened, and getInt would turn that into 0 — a real HTTP status.
        sendStatus = getObject("send_status") as? Int,
        sendMessage = getString("send_message"),
        startStatus = getObject("start_status") as? Int,
        startMessage = getString("start_message"),
        createdAt = getString("created_at"),
        updatedAt = getString("updated_at"),
    )
}
