-- The /geo/* routes proxy Geonorge/Kartverket without storing anything: a 30-day TTL meant
-- a teig split or a new address could be served stale into a live matrikkel regulering.
-- Nothing reads this table any more.

DROP TABLE IF EXISTS geo_cache;
