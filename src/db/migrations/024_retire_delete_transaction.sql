-- 0.19.0 replaced the assistant's delete_transaction with the bulk
-- delete_transactions. A pending proposal of the old tool could no longer be
-- applied, so close it.

UPDATE agent_proposals
SET status = 'rejected', error = 'Tool retired', decided_at = now()
WHERE status = 'pending' AND tool = 'delete_transaction';
