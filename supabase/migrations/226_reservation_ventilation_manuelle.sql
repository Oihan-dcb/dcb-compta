-- Migration 226 : verrou d'ajustement manuel de la ventilation.
-- Quand true, AUCUN moteur de ventilation (api/ventiler, ventilation-auto nightly,
-- update-ventilation-auto temps réel) ne recalcule cette résa — les montants saisis
-- à la main (ex. HON baissé pour augmenter LOY) sont préservés.
alter table reservation add column if not exists ventilation_manuelle boolean not null default false;
