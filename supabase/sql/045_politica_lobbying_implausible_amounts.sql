-- Stops an outside firm's impossible quarterly figure from counting. Already applied.
--
-- "LOC Community Association" reports $20,000,000 a quarter for "State of LOC Nation Global
-- Public Benefit Corporation", a client another registrant bills $20,000. Every rollup sums
-- `amount`, so it ranked as the top lobbying spender of 2025 ($80M, ahead of the U.S. Chamber's
-- $70.29M) and added $40M to 2026. normalizeLdaFiling now leaves `amount` null above $5M a quarter
-- for outside firms (countedAmount in lib/adapters/lda.ts); this applies the same rule to the
-- rows already stored. `income` keeps the reported figure. In-house reports are untouched: the
-- Chamber legitimately reports ~$19M of its own expenses a quarter.
update public.lobbying_filings
set amount = null
where not is_in_house
  and amount > 5000000;

select public.lobbying_refresh_client_stats();
select public.lobbying_refresh_bill_stats();
