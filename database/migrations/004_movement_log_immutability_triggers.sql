-- database/migrations/004_movement_log_immutability_triggers.sql
-- Enforces the append-only movement log invariant at the database boundary.

CREATE TRIGGER IF NOT EXISTS trg_prevent_movement_log_update
BEFORE UPDATE ON movement_logs
BEGIN
    SELECT RAISE(ABORT, 'Movement logs are immutable and cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_movement_log_delete
BEFORE DELETE ON movement_logs
BEGIN
    SELECT RAISE(ABORT, 'Movement logs are immutable and cannot be deleted');
END;
