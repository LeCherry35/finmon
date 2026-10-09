-- 0.18.0 removed the assistant's verify_transaction tool and replaced
-- update_transaction / set_plan with the bulk update_transactions / set_plans.
-- A pending proposal of a retired tool could no longer be applied, so close it.

UPDATE agent_proposals
SET status = 'rejected', error = 'Tool retired', decided_at = now()
WHERE status = 'pending'
  AND tool IN ('verify_transaction', 'update_transaction', 'set_plan');
