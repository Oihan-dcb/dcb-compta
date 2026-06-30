-- Migration 204 - indexes for PowerHouse contract auto-sync
-- Prevents statement timeouts on the reservation scan used by /api/cron-auto-contracts.

CREATE INDEX IF NOT EXISTS idx_reservation_contract_sync_dates
  ON reservation (arrival_date, created_at);

CREATE INDEX IF NOT EXISTS idx_reservation_code
  ON reservation (code);

CREATE INDEX IF NOT EXISTS idx_reservation_bien_id
  ON reservation (bien_id);
