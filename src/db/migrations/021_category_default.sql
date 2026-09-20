-- Each user has exactly one default category: the fallback a transaction lands
-- on when its category is deleted, and the category a receipt scan picks when
-- it can't match one of the user's own names. Named 'other' out of the box
-- (the literal the scan already answers with), but renameable and movable.
ALTER TABLE categories ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one default per user. setDefaultCategoryFor clears before it sets.
CREATE UNIQUE INDEX categories_one_default_per_user
  ON categories(user_id) WHERE is_default;

-- Every user who already has categories gets an 'other' to fall back to.
INSERT INTO categories (name, priority, user_id)
  SELECT 'other', 5, user_id FROM categories GROUP BY user_id
  ON CONFLICT (user_id, name) DO NOTHING;

-- Promote it. A user may own several rows differing only in case ('Other' /
-- 'other'), and the partial unique index allows only one, so pick exactly one
-- row per user (lowest id wins).
UPDATE categories SET is_default = TRUE
 WHERE id IN (
   SELECT DISTINCT ON (user_id) id
     FROM categories
    WHERE lower(name) = 'other'
    ORDER BY user_id, id
 );
