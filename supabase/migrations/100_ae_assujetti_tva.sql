-- Migration 100 : champ assujetti TVA sur auto_entrepreneur
-- À appliquer dans Supabase Dashboard → SQL Editor

ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS is_assujetti_tva boolean DEFAULT false;
