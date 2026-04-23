-- PowerHouse DCB — ajout colonne email_sent sur devis_requests
alter table devis_requests
  add column if not exists email_sent boolean not null default false;
