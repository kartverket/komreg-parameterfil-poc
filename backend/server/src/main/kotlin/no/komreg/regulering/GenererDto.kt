package no.komreg.regulering

import kotlinx.serialization.Serializable

/*
 * Our own API towards the frontend — not komreg-backend's format (that is in
 * ReguleringDto.kt).
 *
 * The cut is deliberately at ALREADY RESOLVED rows: the frontend has run buildKomregRows
 * and resolveTarget, and sends the result. resolveTarget is shared with validate.ts
 * precisely so the check and what is exported cannot drift apart (see frontend/AGENTS.md)
 * — a copy of those rules here would reintroduce exactly that drift. This slice owns the
 * wire format and nothing else.
 */

/**
 * One movement, with both the current and the new values. Everything is a String because
 * leading zeros carry meaning (kommunenummer "0301"), and the values end up as strings
 * inside fra/til anyway.
 *
 * A blank [bruksnummer] means THE WHOLE GÅRD, not a missing value — the same convention as
 * the frontend's whole-gnr rows. See byggMatrikkelenhet.
 */
@Serializable
data class RadDTO(
    // The frontend's stable row id (e.g. "m:5060-90/4"). Used only in error messages, so
    // an error can point at a row the user can see.
    val id: String,
    val type: String,
    val kommunenummer: String = "",
    val nyKommunenummer: String = "",
    val gardsnummer: String = "",
    val bruksnummer: String = "",
    val nyGardsnummer: String = "",
    val nyBruksnummer: String = "",
    val adressekode: String = "",
    val nyAdressekode: String = "",
    val adressenummer: String = "",
    val nyAdressenummer: String = "",
    val teigid: String = "",
)

@Serializable
data class GenererRequest(
    val id: String,
    val navn: String,
    val dato: String,
    val rader: List<RadDTO>,
)

/**
 * One downloadable file. [json] is already serialized by [reguleringJson] — exactly the
 * bytes komreg-backend is to receive. The frontend downloads it unchanged instead of
 * re-serializing, so that kotlinx, not JavaScript, decides the format.
 */
@Serializable
data class ReguleringFil(
    // "samlet", or "<fra>-<til>" for one kommunepar.
    val key: String,
    val fra: String? = null,
    val til: String? = null,
    val filnavn: String,
    // Number of transformasjoner per type, for the overview in the UI.
    val antall: Map<String, Int>,
    val json: String,
)

@Serializable
data class GenererResponse(
    val samlet: ReguleringFil,
    val perPar: List<ReguleringFil>,
)
