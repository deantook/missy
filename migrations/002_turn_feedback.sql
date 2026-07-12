ALTER TABLE chat_turns
  ADD COLUMN IF NOT EXISTS feedback text CHECK (feedback IS NULL OR feedback IN ('like', 'dislike')),
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz;
