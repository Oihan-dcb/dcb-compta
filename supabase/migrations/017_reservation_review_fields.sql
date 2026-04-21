ALTER TABLE reservation
  ADD COLUMN IF NOT EXISTS review_id      text,
  ADD COLUMN IF NOT EXISTS guest_email    text,
  ADD COLUMN IF NOT EXISTS guest_locale   text,
  ADD COLUMN IF NOT EXISTS guest_region   text,
  ADD COLUMN IF NOT EXISTS review_rating  integer;
