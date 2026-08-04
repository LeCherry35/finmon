-- A plan of 0 is meaningful: "I intend to spend nothing here", and any spend
-- against it shows as over-budget. The original CHECK (amount > 0) from
-- migration 001 (auto-named plans_amount_check, carried through the type change
-- in migration 002) rejected that, so relax it to allow zero.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_amount_check;
ALTER TABLE plans ADD CONSTRAINT plans_amount_check CHECK (amount >= 0);
