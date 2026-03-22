# Charte graphique Destination Côte Basque
## Référence : destinationcotebasque.com

### Palette couleurs (zéro bleu)

| Variable        | Hex       | Usage                                  |
|-----------------|-----------|----------------------------------------|
| --gold          | #CC9933   | Or principal — accents, CTA, filets    |
| --gold-light    | #E4A853   | Or clair — hover, highlights           |
| --gold-pale     | #FFF8EC   | Or très pâle — fond boutons actifs     |
| --dark          | #2C2416   | Brun très foncé — texte principal      |
| --dark-warm     | #3D3020   | Brun chaud — hover bouton principal    |
| --cream         | #F7F3EC   | Crème — fond général                   |
| --cream-dark    | #EDE8DE   | Crème foncé — fond cartes inactives    |
| --header-bien   | #EAE3D4   | Crème pastel — header biens + nav top  |
| --text-muted    | #8C7B65   | Brun clair — texte secondaire          |
| --border        | #D9CEB8   | Beige — bordures                       |
| --white         | #FFFFFF   | Blanc                                  |

### Filet signature
- Toujours `2px solid #CC9933` en bas des headers (nav, biens, bulles)

### Typographie
- **Logo** : Questial (Google Fonts)
- **Corps** : -apple-system, BlinkMacSystemFont, Segoe UI, Arial

### Composants clés
- **Bouton principal** : fond `#CC9933`, texte blanc, border-radius 10px
- **Input focus** : border-color `#CC9933`
- **Header navigation** : fond `#EAE3D4` + filet bas `2px solid #CC9933`
- **Header biens (portail)** : fond `#EAE3D4` + filet bas `2px solid #CC9933` + texte `#2C2416`
- **Bulle total/missions** : fond `#EAE3D4` + border `2px solid #CC9933`
- **Nav link actif** : fond `#CC9933` + texte blanc

### Apps concernées
- dcb-compta.vercel.app (App.css)
- dcb-portail-ae.vercel.app (index.css + Portail.jsx + Login.jsx)
