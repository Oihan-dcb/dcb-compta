-- Ajoute 'assistante' comme valeur valide pour auto_entrepreneur.type
ALTER TABLE auto_entrepreneur
  DROP CONSTRAINT IF EXISTS auto_entrepreneur_type_check;

ALTER TABLE auto_entrepreneur
  ADD CONSTRAINT auto_entrepreneur_type_check
  CHECK (type IN ('ae', 'staff', 'assistante'));
