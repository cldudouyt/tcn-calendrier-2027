# CLAUDE.md — Calendrier & veille multisports Pays de la Loire 2027

> Spécification de réalisation pour Claude Code. Date de référence : 13 novembre 2026.
> **Projet autonome** : ne pas modifier le site existant TCN Quiberon.

## 1. Mission et périmètre

Construire un nouveau site web, utilisable sur mobile, destiné aux membres du Triathlon Club Nantais (TCN) et aux sportifs souhaitant explorer les compétitions multisports de la saison 2026–2027. Il rassemble les **78 rendez-vous** recensés dans le PDF de référence : triathlon, duathlon, aquathlon, cross-triathlon, swimrun, Bike & Run et endurathlon. Une journée d'épreuve = une entrée ; ne pas fusionner des journées distinctes d'un même week-end.

Périmètre géographique principal : Loire-Atlantique (44), Maine-et-Loire (49), Mayenne (53), Sarthe (72), Vendée (85). Les **11 rendez-vous hors région** mentionnés séparément dans le PDF ne font pas partie des 78 événements principaux : prévoir éventuellement une rubrique distincte, sans les compter dans le total régional.

**Fichier source** : `calendrier-2027.pdf` (20 pages). Pages 1–7 : carte et listes départementales ; pages 8–14 : calendrier chronologique ; pages 15–20 : transports depuis Nantes. `data.json` contient une transcription initiale des 78 entrées ; à auditer et enrichir à partir du PDF. `assets/carte-pdf.png` est une image de référence, **pas** une carte interactive.

**Objectif éditorial** : aider à choisir une épreuve, savoir quand s'inscrire et comment rejoindre le lieu de départ, y compris avec un vélo.

## 2. Identité visuelle — impératif : cohérente avec le site Quiberon du TCN

La charte n'est **pas une palette supposée** : valeurs relevées dans `app/globals.css` du dépôt privé existant **`cldudouyt/tcn-quiberon-inscriptions`**, branche `main`, consulté le 13 novembre 2026. Site de référence connu : `https://tcn-quiberon-inscriptions.cldudouyt.workers.dev/`.

### Couleurs exactes à réutiliser

| Jeton CSS | Valeur | Usage |
| --- | --- | --- |
| `--ink` | `#1C1E22` | Titres, texte principal, fonds sombres |
| `--ink-2` | `#3A3D44` | Variante sombre, éléments graphiques |
| `--ink-3` | `#5B5E65` | Variante ardoise |
| `--body` | `#3A3833` | Texte courant secondaire fort |
| `--muted` | `#726C61` | Métadonnées, descriptions secondaires |
| `--grey` | `#B0AAA0` | Lignes et indicateurs secondaires |
| `--paper` | `#F4F3F0` | Fond général, ivoire/gris chaud |
| `--sunk` | `#FAF9F7` | Fonds de sections ou panneaux discrets |
| `--line` | `#EBE8E2` | Bordures de cartes et séparateurs |
| `--line-faint` | `#F1EFEA` | Bordures atténuées |
| `--line-input` | `#D8D4CC` | Champs, contrôles |
| `--orange` | `#E9530E` | Accent de marque, chiffres, icônes, repères |
| `--orange-deep` | `#D64000` | Boutons principaux, actions |
| `--orange-deeper` | `#B83A00` | Hover et texte accentué sur fond clair |
| `--orange-200` | `#F8B58C` | Bordures d'accent, illustrations |
| `--orange-10` | `rgba(233, 83, 14, 0.10)` | Fonds de pastilles et sélection |
| `--success` | `#176039` | Inscriptions confirmées ouvertes |
| `--success-bg` | `#F0FDF5` | Fond de statut positif |
| `--success-border` | `#84D4A8` | Bordure de statut positif |
| `--warning` | `#7A5800` | Données à confirmer / attention |
| `--warning-bg` | `#FDF8F0` | Fond d'avertissement |
| `--warning-border` | `#E6D29A` | Bordure d'avertissement |

Définir ces valeurs dans une feuille unique `src/styles/tokens.css` (ou `app/globals.css` selon la stack), et les employer comme variables CSS, sans dispersion de valeurs hexadécimales dans les composants. Exemple :

```css
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600;700;800&family=Barlow+Semi+Condensed:wght@600;700;800&display=swap');
:root {
  --ink: #1c1e22; --ink-2: #3a3d44; --ink-3: #5b5e65;
  --body: #3a3833; --muted: #726c61; --grey: #b0aaa0;
  --paper: #f4f3f0; --sunk: #faf9f7;
  --line: #ebe8e2; --line-faint: #f1efea; --line-input: #d8d4cc;
  --orange: #e9530e; --orange-deep: #d64000;
  --orange-deeper: #b83a00; --orange-200: #f8b58c;
  --orange-10: rgba(233,83,14,.10);
  --success: #176039; --success-bg: #f0fdf5;
  --success-border: #84d4a8;
  --warning: #7a5800; --warning-bg: #fdf8f0;
  --warning-border: #e6d29a;
  --display: 'Anton', 'Barlow', sans-serif;
  --cond: 'Barlow Semi Condensed', 'Barlow', sans-serif;
}
body { background: var(--paper); color: var(--ink); font-family: 'Barlow', system-ui, sans-serif; }
h1, h2, h3 { font-family: var(--display); font-weight: 400; }
.eyebrow { color: var(--orange-deeper); font-family: var(--cond); text-transform: uppercase; letter-spacing: .16em; }
.btn-primary { background: var(--orange-deep); color: white; }
.btn-primary:hover { background: var(--orange-deeper); }
```

### Direction artistique

- Reprendre le vocabulaire graphique de Quiberon : typographie **Anton** pour titres majeurs/chiffres, **Barlow** pour le corps et **Barlow Semi Condensed** pour menus, petits titres et étiquettes ; **orange chaud + encre anthracite + papier ivoire**, pas un thème bleu/vert par défaut.
- Header net, héros éditorial à très grand titre, grands chiffres de statistiques, étiquettes en capitales espacées, grandes cartes blanches arrondies (rayon ~18 px), ombres discrètes, bordures beige-gris.
- Boutons d'action orange profond ; états de survol orange plus foncé ; focus clavier visible. Respecter les contrastes WCAG AA : ne pas utiliser un orange trop clair comme couleur de texte sur du blanc.
- **Ne pas confondre les couleurs de marque avec les statuts** : le vert `--success` signifie « inscriptions ouvertes confirmées », l'ocre `--warning` signifie « annoncées / informations à confirmer ». Fermé/complet/annulé ont des libellés explicites, jamais uniquement des couleurs.
- Pour les marqueurs de carte, garder une palette de départements ou de disciplines distincte si nécessaire ; **l'habillage global demeure TCN orange/ivoire/anthracite**. Afficher une légende textuelle pour les catégories de transports, pas seulement des codes de couleur.
- Responsive : contrôles utilisables au doigt, menu et filtres accessibles, aucune table impossible à lire sur téléphone. Animations discrètes et respect de `prefers-reduced-motion`.
- Ne pas reprendre de données privées ni de logique d'inscription du site Quiberon. Il sert **uniquement de référence visuelle**.

## 3. Structure fonctionnelle du site

### Accueil `/`

- Titre « Épreuves multisports Pays de la Loire 2027 » et mention de la période novembre 2026 → novembre 2027.
- KPI : rendez-vous régionaux suivis, inscriptions ouvertes **vérifiées**, ouvertures annoncées, informations restant à confirmer. Calculer les KPI depuis les données ; ne pas figer les chiffres.
- Focus « dernières nouveautés de la veille » avec horodatage et liens officiels.
- Accès direct à la carte, au calendrier, aux filtres et au PDF original.

### Calendrier `/calendrier`

- Vues liste chronologique et mois (facultativement agenda et semaine).
- Filtres cumulables : département, discipline, distance/format (XS/S/M/L/XXL, jeunes, relais), mois, statut d'inscription, facilité d'accès en transports.
- Recherche par nom de course et commune ; tri par date puis nom.
- Regrouper visuellement un week-end tout en conservant **chaque date/format comme entrée distincte**.
- Export facultatif `.ics` et partage d'une URL filtrée.

### Carte `/carte`

- Carte interactive (Leaflet + OpenStreetMap ou équivalent), centrée sur les Pays de la Loire, avec regroupement des points proches.
- Points sélectionnables : nom, dates, formats, statut d'inscription, transport, lien vers la fiche.
- Ne pas confondre les coordonnées approximatives **du centre de commune** (actuellement dans `data.json`) avec les coordonnées exactes du départ de course. Indiquer « position indicative » tant que le point de départ n'est pas vérifié.
- Filtres de la carte synchronisés avec ceux de la liste ; affichage par département et, si souhaité, catégorie d'épreuve.

### Détail `/epreuves/[slug]`

Afficher nom, discipline, date complète et année, formats, commune, département, source de la date, statut d'inscription et date de dernière vérification, prix **uniquement si sourcé**, lien d'inscription **officiel et vérifié**, coordonnées et adresse du départ quand connues, accès depuis Nantes (voir §5), notes logistiques et bouton de partage.

### Veille `/veille`

- Journal des relevés hebdomadaires avec date/heure Europe/Paris et évolution par rapport au relevé précédent.
- Catégories : **ouvert confirmé**, **ouverture annoncée** (date ou fenêtre), **non confirmé**, **complet**, **fermé**, **annulé**, **modification de date/format**.
- Liens vers les sources officielles, capture du fait vérifié, date de vérification ; ne jamais conclure « fermé » simplement faute de page d'inscription.
- Détection des nouveautés entre deux relevés et suppression des faux doublons.
- La veille ChatGPT existante du **lundi à 08 h 30** ne publie **pas** automatiquement sur un site tiers : prévoir une intégration technique indépendante et explicite pour alimenter le site (import JSON validé par administrateur, ou tâche planifiée Cloudflare effectuant elle-même les contrôles).
- **Ne pas inventer** un webhook ChatGPT ni supposer un accès direct aux résultats de l'automatisation ChatGPT.

### Documents `/documents`

- Lien pour consulter/télécharger `calendrier-2027.pdf` et indication de son millésime et de la date de vérification.
- La carte PDF (image de référence) peut apparaître ici ; elle ne remplace pas la carte interactive.

## 4. Modèle de données

Lire `data.json` initial (78 objets), chaque objet ayant à ce stade les clés : `id`, `department`, `date`, `name`, `formats`, `town`, `kind`, `transport`, `journey`, `lastMile`, `status`, `statusDetail`, `registrationUrl`, `coords`.

- `date` en ISO `YYYY-MM-DD` et affichage français Europe/Paris. Définir une ID stable indépendante du tri.
- `coords` contient **`[latitude, longitude]`**, contrairement aux conventions GeoJSON `[longitude, latitude]`. Convertir explicitement si nécessaire.
- Conserver les 78 entrées initiales, la distinction 2026/2027, les noms accentués et les 20/10/15/13/20 entrées respectivement pour les départements 44/49/53/72/85.
- Ajouter progressivement : `officialUrl`, `registrationOpenAt`, `registrationStatus`, `price`, `currency`, `sourceUrl`, `lastCheckedAt`, `changedAt`, `raceStartLocation`, `raceStartLatLon`, `locationAccuracy`, `registrationEvidence`, `transportLastCheckedAt`, `transportBikePolicy`.
- Lier les éditions et les journées d'un même événement (champ `eventGroupId`) **sans** les faire disparaître du total des rendez-vous.
- Stocker l'historique des statuts, la provenance et les dates de vérification ; ne jamais remplacer une information vérifiée par une supposition issue d'un moteur de recherche.
- Points de contrôle explicites signalés dans le PDF : duathlon des Sables le 28 mars (lieu/date à recouper), swimrun de Xanton le 29 mai (libellé ambigu), Triathlon de Nantes le 17 octobre (formats à confirmer).

## 5. Transports — fonctionnalité de premier niveau

Départ de référence : **gare de Nantes** ; prévoir plus tard une origine configurable. Exploiter les pages 15–20 du PDF comme **itinéraires indicatifs datés du 13/11/2026**, pas comme horaires 2027 confirmés.

Codes existants de `data.json` :

| Code | Sens |
| --- | --- |
| `D` | Train direct jusqu'à la commune |
| `C` | Train avec correspondance |
| `M` | Train puis autre mode ou trajet vers une autre commune |
| `B` | Car direct depuis Nantes |
| `L` | Transports urbains ou locaux depuis Nantes |
| `?` | Itinéraire à préciser |

Chaque fiche doit séparer : (1) gare ou arrêt d'arrivée, (2) correspondances et moyen de transport, (3) **dernier kilomètre jusqu'au départ exact**, (4) faisabilité d'arrivée **avant le départ de la course**, (5) retour le même jour, (6) **conditions de transport du vélo** (vélo monté/plié, réservation, capacité, règles régionales, jour de compétition), (7) incertitudes explicites.

- Pour des horaires/prix/trajets réels, consulter des données d'opérateur ou de calcul d'itinéraire actualisées à la date du déplacement ; afficher source et horodatage. À défaut, afficher « horaires à vérifier », **jamais de durée, tarif ou dernier train inventé**.
- Liens de comparaison appropriés : SNCF/TER Pays de la Loire, Aléop, Naolib, opérateurs urbains concernés ; lien de recherche d'itinéraire si intégré.
- Filtres : « train direct », « transport public possible + correspondance », « avec vélo », « accès inconnu ». La catégorie « vélo autorisé » n'est attribuée qu'après confirmation de la règle applicable à la date.
- Dans les éventuelles alertes de transport, distinguer « service connu en 2026 » de « horaire 2027 validé ».

## 6. Fonctionnement de la veille et intégration Cloudflare

**Cible d'hébergement : Cloudflare**, dans un nouveau projet séparé de Quiberon. Une architecture possible : frontend statique Cloudflare Pages / Workers Static Assets, et Cloudflare Worker + D1 (ou R2/KV selon besoins) pour le stockage des vérifications, statuts et historiques. Utiliser les services disponibles sur le compte et suivre la documentation de la version en cours de Cloudflare/Wrangler au moment de développer.

- Prévoir `GET /api/events` et `GET /api/events/:id`, `GET /api/updates` ; endpoints d'administration protégés pour importer/valider les changements.
- Planificateur hebdomadaire le **lundi 08:30 Europe/Paris**. Attention : le cron des Workers est évalué en UTC ; gérer correctement les changements d'heure été/hiver si l'heure locale doit être exacte. Éviter une simple chaîne « 07:30 UTC » permanente.
- Une publication n'est faite **qu'après vérification** des liens et statuts. Prévoir mécanismes de reprise, journal des erreurs, déduplication, journal des modifications et possibilité de correction manuelle.
- Respecter les conditions d'utilisation et les limites des sites d'inscription ; privilégier pages officielles et interfaces autorisées ; pas de contournement de CAPTCHA ou d'accès protégé.
- Ne pas promettre de notification WhatsApp automatique à plusieurs centaines de personnes ; le site peut fournir une page publique et des liens facilement partageables, ou un flux RSS facultatif.
- Les identifiants Cloudflare et secrets de notification ne doivent jamais être committés ; passer par variables d'environnement/secrets. Protéger toute route d'administration. Ne pas mettre d'informations personnelles des membres du TCN sur ce site.

## 7. Plan d'implémentation proposé

1. **Audit et données** : contrôler les 78 entrées, leurs 5 totaux départementaux, les années, les formats, les points incertains ; rendre le JSON conforme à un schéma validé.
2. **Design system Quiberon** : créer les variables CSS et une page de composants (titres, boutons, formulaires, cartes, badges, états) ; vérifier le rendu mobile.
3. **Site public** : accueil, calendrier filtrable, recherche, fiches détaillées, carte interactive et document PDF.
4. **Transport** : reprendre `journey` et `lastMile`, ajouter drapeaux de certitude et préparation de la vérification train + vélo.
5. **Veille** : base de données des sources et historiques, import manuel fiable, puis automation externe après validation des sources.
6. **Tests** : tests de parsing, filtres, navigation, affichage mobile, contraste, clavier, lien d'inscription, synchronisation cartes/liste, gestion des statuts contradictoires.
7. **Cloudflare** : préparer la configuration (`wrangler`), déploiement distinct, contrôle d'accès admin, puis tester les ressources statiques et APIs et vérifier le site déployé avant de communiquer une URL.

## 8. Tests d'acceptation non négociables

- Le chargement initial affiche **78 rendez-vous régionaux** répartis 44=20, 49=10, 53=15, 72=13, 85=20. Les 11 dates hors région restent séparées.
- La palette et la typographie sont identiques dans leurs **valeurs source** au site Quiberon : `#E9530E`, `#D64000`, `#1C1E22`, `#F4F3F0`, Anton / Barlow / Barlow Semi Condensed.
- Une course ouverte n'a le badge « ouvert » que si une source officielle identifiée l'atteste. Les 69 autres fiches « inconnues » de la transcription initiale ne sont pas arbitrairement marquées fermées.
- Toute carte affiche que les points non vérifiés sont des localisations **indicatives**.
- Les transports affichent explicitement la différence entre **atteindre la commune** et **atteindre le départ avec un vélo** ; un itinéraire incertain n'est jamais présenté comme garanti.
- Le PDF est consultable ; le calendrier et la carte sont accessibles sur téléphone.
- La veille affiche sa dernière date de contrôle et un historique des différences ; aucun contenu de ChatGPT n'est supposé automatiquement transmis.
- Aucun changement, suppression ou redéploiement du projet Quiberon existant.

## 9. Conventions pour Claude Code

- Avant toute modification, lire ce `CLAUDE.md`, `data.json` et inspecter les fichiers existants. Réutiliser ce qui est déjà présent ; ne pas recréer les données depuis zéro si non nécessaire.
- Travailler en français pour l'interface et les contenus ; noms de fonctions et types en anglais possibles.
- Utiliser TypeScript avec types stricts si le frontend le permet. Éviter les dépendances superflues ; isoler la carte et les services externes.
- Rendre un résultat vérifiable à chaque étape : fichiers modifiés, tests exécutés, points restant inconnus.
- Ne jamais inventer prix, horaires, statut d'ouverture, coordonnées exactes ou capacités de transport des vélos.
- **La publication Cloudflare est une étape séparée** : construire/tester localement d'abord ; déployer seulement lorsque la configuration et l'accès au compte sont confirmés.
