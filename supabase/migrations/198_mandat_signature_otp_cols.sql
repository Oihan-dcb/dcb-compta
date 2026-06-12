-- Phase 2.3 — Colonnes OTP inline pour la signature du mandat (1 signataire = 1 code actif).
alter table mandat_signature
  add column if not exists otp_hash          text,
  add column if not exists otp_expires_at    timestamptz,
  add column if not exists identite_path     text,   -- photo CNI (bucket mandats)
  add column if not exists identite_taken_at timestamptz;
