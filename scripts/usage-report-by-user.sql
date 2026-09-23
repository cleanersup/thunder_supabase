-- Usage report per account: 2025-09-18 → 2026-09-18 (inclusive).
-- Counts residential/commercial estimates, invoices (created / sent / paid),
-- jobs and requests, joined with the owner's email.
--
-- Run (streams CSV to stdout):
--   docker exec -i supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres \
--     < scripts/usage-report-by-user.sql > usage_report.csv

COPY (
WITH bounds AS (
  SELECT TIMESTAMPTZ '2025-09-18 00:00:00+00' AS from_ts,
         TIMESTAMPTZ '2026-09-19 00:00:00+00' AS to_ts   -- exclusive upper bound
),
est AS (
  SELECT e.user_id,
         COUNT(*) FILTER (WHERE lower(e.service_type) = 'residential') AS residential_estimates,
         COUNT(*) FILTER (WHERE lower(e.service_type) = 'commercial')  AS commercial_estimates,
         COUNT(*) FILTER (WHERE e.status <> 'Draft')                   AS estimates_sent
  FROM public.estimates e, bounds b
  WHERE e.created_at >= b.from_ts
    AND e.created_at <  b.to_ts
    AND COALESCE(e.is_draft, false) = false
  GROUP BY e.user_id
),
inv AS (
  SELECT i.user_id,
         COUNT(*)                                       AS invoices_created,
         COUNT(*) FILTER (WHERE i.status <> 'Draft')    AS invoices_sent,
         COUNT(*) FILTER (WHERE i.status =  'Paid')     AS invoices_paid
  FROM public.invoices i, bounds b
  WHERE i.created_at >= b.from_ts
    AND i.created_at <  b.to_ts
  GROUP BY i.user_id
),
jb AS (
  SELECT j.user_id,
         COUNT(*) FILTER (WHERE j.parent_job_id IS NULL) AS jobs_created,
         COUNT(*)                                        AS jobs_incl_recurring
  FROM public.jobs j, bounds b
  WHERE j.created_at >= b.from_ts
    AND j.created_at <  b.to_ts
  GROUP BY j.user_id
),
req AS (
  SELECT r.business_owner_id AS user_id,
         COUNT(*)            AS requests_created
  FROM public.bookings r, bounds b
  WHERE r.created_at >= b.from_ts
    AND r.created_at <  b.to_ts
  GROUP BY r.business_owner_id
),
ids AS (
  SELECT user_id FROM est
  UNION SELECT user_id FROM inv
  UNION SELECT user_id FROM jb
  UNION SELECT user_id FROM req
)
SELECT
  COALESCE(NULLIF(btrim(u.email::text), ''), 'NA')      AS email,
  COALESCE(NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'NA') AS name,
  COALESCE(NULLIF(btrim(p.company_name), ''), 'NA')     AS company_name,
  COALESCE(NULLIF(btrim(p.phone_number), ''), 'NA')     AS phone_number,
  COALESCE(NULLIF(btrim(p.company_phone), ''), 'NA')    AS company_phone,
  COALESCE(NULLIF(btrim(p.company_email), ''), 'NA')    AS company_email,
  COALESCE(NULLIF(btrim(p.company_address), ''), 'NA')  AS company_address,
  COALESCE(NULLIF(btrim(p.company_apt_suite), ''), 'NA') AS company_apt_suite,
  COALESCE(NULLIF(btrim(p.company_city), ''), 'NA')     AS company_city,
  COALESCE(NULLIF(btrim(COALESCE(p.company_state, p.state)), ''), 'NA') AS company_state,
  COALESCE(NULLIF(btrim(p.company_zip), ''), 'NA')      AS company_zip,
  COALESCE(est.residential_estimates, 0)                AS residential_estimates,
  COALESCE(est.commercial_estimates, 0)                 AS commercial_estimates,
  COALESCE(est.estimates_sent, 0)                       AS estimates_sent,
  COALESCE(inv.invoices_created, 0)                     AS invoices_created,
  COALESCE(inv.invoices_sent, 0)                        AS invoices_sent,
  COALESCE(inv.invoices_paid, 0)                        AS invoices_paid,
  COALESCE(jb.jobs_created, 0)                          AS jobs_created,
  COALESCE(jb.jobs_incl_recurring, 0)                   AS jobs_incl_recurring,
  COALESCE(req.requests_created, 0)                     AS requests_created
FROM ids
LEFT JOIN auth.users      u ON u.id      = ids.user_id
LEFT JOIN public.profiles p ON p.user_id = ids.user_id
LEFT JOIN est ON est.user_id = ids.user_id
LEFT JOIN inv ON inv.user_id = ids.user_id
LEFT JOIN jb  ON jb.user_id  = ids.user_id
LEFT JOIN req ON req.user_id = ids.user_id
ORDER BY
  COALESCE(est.residential_estimates, 0) + COALESCE(est.commercial_estimates, 0)
  + COALESCE(inv.invoices_created, 0) + COALESCE(jb.jobs_created, 0)
  + COALESCE(req.requests_created, 0) DESC,
  email
) TO STDOUT WITH CSV HEADER;
