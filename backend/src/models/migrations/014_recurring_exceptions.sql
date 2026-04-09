-- Exception instances for recurring events (Google Calendar Series-Instance model)
-- recurring_master_id: links a standalone exception instance back to its series master
-- original_start_at: the virtual occurrence date/time this instance replaced
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurring_master_id INTEGER REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS original_start_at TIMESTAMPTZ;
