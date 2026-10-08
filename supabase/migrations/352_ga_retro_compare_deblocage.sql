-- 352 — Comparateur IA (ga-retro-compare) bloqué depuis fin août 2026 (08/10/2026) : il relisait à
-- chaque passage les 20 plus vieux jobs pending/superseded, or un job « superseded » le reste à vie →
-- fenêtre figée, 223 propositions jamais comparées. On marque désormais chaque job traité, et on
-- garde qui a réellement répondu (IA Hospitable / staff) + le message voyageur, pour l'analyse.
alter table public.chat_llm_jobs add column if not exists retro_compare_at timestamptz;
alter table public.ga_correction add column if not exists real_source text;      -- 'ia_hospitable' | 'staff' | autre source brute
alter table public.ga_correction add column if not exists real_sent_at timestamptz;
alter table public.ga_correction add column if not exists guest_message text;
alter table public.ga_correction add column if not exists verdict text;          -- bon_match | match_partiel | mismatch
-- Jobs déjà comparés avant ce correctif : marqués pour ne pas être refaits.
update public.chat_llm_jobs j set retro_compare_at = now()
 where j.retro_compare_at is null and exists (select 1 from public.ga_correction c where c.job_id = j.id);
