ALTER TABLE conversations ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE INDEX IF NOT EXISTS conversations_visible_user_updated_idx
  ON conversations(user_id, updated_at DESC, id DESC)
  WHERE hidden_at IS NULL;
