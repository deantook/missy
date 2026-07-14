ALTER TABLE chat_turns
  DROP CONSTRAINT IF EXISTS chat_turns_status_check;

ALTER TABLE chat_turns
  ADD CONSTRAINT chat_turns_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled'));
