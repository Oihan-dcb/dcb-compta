# DCB Compta — Journal session 22 mars 2026 (partie 10)

## Bugs résolus
- prestation_type en triple en base (15 lignes) : DELETE + réinsertion 5 types propres
- RLS manquante sur prestation_type, taux_ae_prestation, prestation_hors_forfait : policies créées
- facture_ae supprimée (inutilisée)
- AIRBNB_FEES_RATE 0.1395 → 0.1621 (16.21%)
- charger() redondant après ajouterPrestation/syncICal : rechargement missions local uniquement
- Responsive mobile portail : font-size 16px anti-zoom iOS, flex-wrap, padding

## Nouvelles fonctionnalités
- Flag AUTO réel vs provision dans TableReservations (🔴/🟢 + tooltip)
- Edge Function update-ventilation-auto : montant_reel sur AUTO et FMEN
- Balance mensuelle AUTO/FMEN dans PageAutoEntrepreneurs
- Export CSV Rapprochement avec n° virements + réservations

## Charte graphique
- Zéro bleu — palette or/crème/brun sur les deux apps
- --brand #CC9933, --bg #F7F3EC, header nav #EAE3D4 + filet 2px or
- Police logo : Northwell (fichier .ttf à re-uploader en session suivante)
- Référence : docs/charte-graphique.md

## Documentation
- Guide d'utilisation complet Word (33 pages) : DCB_Compta_Guide_Utilisation.docx

## Pending
- Favicons Option A Northwell (re-uploader .ttf)
- Sprint C : facturation Evoliz (bouton tout valider + test push)
- Supprimer AE TEST id: 19a27f7a-4ab2-4b80-a96a-9179a0fb011f
