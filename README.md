# Calendrier & veille multisports — Pays de la Loire 2027

Site du Triathlon Club Nantais : calendrier filtrable, carte interactive, fiches d'épreuves avec accès
depuis Nantes, et veille des inscriptions. Projet autonome, sans lien technique avec le site Quiberon
(qui ne sert que de référence visuelle). La spécification complète est dans [`CLAUDE.md`](CLAUDE.md).

## Démarrer

```bash
npm install
npm run dev          # site en développement (http://localhost:4321)
npm run build        # tests unitaires + vérification des types + génération de dist/
npm run preview      # sert dist/
npm run test:e2e     # tests navigateur (le site doit tourner : preview ou worker:dev)
```

Site complet avec l'API (Worker + base D1 locale) :

```bash
echo 'ADMIN_TOKEN=<jeton local d’au moins 16 caractères>' > .dev.vars   # jamais committé
npm run build && npm run worker:schema:local && npm run worker:dev
```

## Organisation

| Chemin | Rôle |
| --- | --- |
| `data.json` | Les 78 rendez-vous régionaux (source de vérité, validée au build) |
| `data/hors-region.json` | Les 11 rendez-vous hors région, comptés à part |
| `data/releves.json` | Journal de veille publié avec le site |
| `calendrier-2027.pdf`, `assets/carte-pdf.png` | Documents de référence (copiés dans `public/documents/` au build) |
| `src/styles/tokens.css` | Charte TCN : seul fichier contenant des couleurs |
| `src/lib/` | Schéma, statuts, transports, filtres, dates, export `.ics` |
| `src/pages/` | Accueil, calendrier, carte, fiches, veille, documents, hors région, charte (`/composants/`) |
| `src/client/map.ts` | Seul module dépendant de Leaflet / OpenStreetMap |
| `worker/` | Worker Cloudflare : API, administration, contrôle quotidien, schéma D1 |
| `tests/` | Tests unitaires (Vitest) et de bout en bout (Playwright) |

## Règles éditoriales appliquées par le code

- Un statut autre que « non vérifié » exige un fait vérifié, une date de vérification et un lien officiel
  `https` ; sinon il est affiché « non vérifié » (jamais « ouvert » ni « fermé » par supposition).
- Prix, lien d'inscription, horaires, durées et règle vélo ne sont affichés que s'ils sont sourcés.
- Les coordonnées sont des **centres de communes** (API Géo, relevé du 13/11/2026), stockées en
  `[latitude, longitude]` et présentées comme positions indicatives. `raceStartLatLon` reste vide tant
  que le départ n'est pas vérifié.
- Les itinéraires viennent des pages 15 à 20 du PDF : indicatifs, datés, jamais garantis.

## API (Worker)

| Route | Rôle |
| --- | --- |
| `GET /api/events`, `GET /api/events/:id` | Données publiées (référence + changements validés) et historique des statuts |
| `GET /api/status`, `GET /api/updates` | Statuts affichés et journal des changements publiés |
| `POST /api/admin/import` | Importe des propositions `{ changes: [{ eventId, checkedAt, summary, patch }] }` ; elles restent **en attente** |
| `GET /api/admin/changes?state=en_attente` | Liste les propositions |
| `POST /api/admin/changes/:id/validate` ou `/reject` | Publie ou rejette une proposition |
| `PATCH /api/admin/events/:id` | Correction manuelle (même validation, publiée immédiatement) |
| `POST /api/admin/check`, `GET /api/admin/runs` | Relance le contrôle des liens ; journal des contrôles et des erreurs |
| `POST /api/admin/watch/report` | Reçoit le rapport de la veille automatique (propositions en attente, alertes, état des pages) |
| `GET /api/admin/alerts?state=ouverte`, `POST /api/admin/alerts/:id/close` | Alertes de la veille à examiner |

Les routes `/api/admin/*` exigent `Authorization: Bearer <ADMIN_TOKEN>`. Sans secret configuré, elles
répondent 503.

L’import des informations vérifiées ajoute les changements d’inscription confirmés dans `data/veille-inscriptions.json`
sur `main`. Le build vérifie chaque relevé et applique les changements au calendrier, au journal et à
l’API. Cloudflare Workers Builds publie ces données à chaque commit. Les routes d’administration
restent disponibles pour les corrections ponctuelles. Le contrôle planifié du Worker vérifie chaque jour que les liens officiels déjà publiés répondent encore.

## Veille automatique des inscriptions

Chaque matin (`.github/workflows/veille-auto.yml`, vers 7 h à Paris), `scripts/veille-auto.ts` :

1. lit les épreuves publiées (`/api/events`) et les pages à surveiller (`data/sources.json`) ;
2. lit le calendrier régional FFTRI, rapproche chaque manifestation d’une épreuve du site, puis lit sa fiche
   (indicateur d’annulation structuré, dates des courses, liens « Site officiel » et « S’inscrire ») ;
3. lit les pages des organisateurs (robots.txt respecté, une page à la fois, 1,5 s d’intervalle, réseaux sociaux exclus) ;
4. envoie un rapport à `POST /api/admin/watch/report`.

Règles (`worker/watch.ts`), qui ne produisent que des **propositions en attente** :

| Signal | Proposition |
| --- | --- |
| Lien de billetterie pour l’édition 2027 sur une page officielle | « ouvert », avec le lien |
| Phrase d’annonce d’ouverture près de « 2027 », sans billetterie | « annoncé », avec la citation |
| Indicateur `cancelled: true` de la fiche FFTRI | « annulé » |
| Date différente au calendrier FFTRI, manifestation inconnue du site, formats « complets », passages nouveaux sur une page, page muette trois jours de suite | alerte à examiner (aucun effet sur le site) |

Sur une page générale de club (`"scope": "club"`), un lien ou une annonce n’est attribué à une épreuve que si le
texte qui le précède contient un de ses mots-clés. Une proposition rejetée n’est jamais reproposée ; une alerte
traitée n’est jamais recréée à l’identique.

Les propositions se valident sur **`/admin/`** (page non référencée, jeton `ADMIN_TOKEN`). Ajouter une page à
surveiller : compléter `data/sources.json` (les tests vérifient le fichier).

Mise en service : secret `ADMIN_TOKEN` (même valeur que sur Cloudflare) dans GitHub → Settings → Secrets and
variables → Actions ; variable `SITE_URL` facultative. Essai sans rien envoyer : `npm run veille:simulation`
(ou lancer le workflow à la main avec « Simulation »).

Planification : deux déclenchements UTC chaque jour (06:30 et 07:30) ; le Worker n'exécute que celui qui
tombe à 08 h 30 à Paris, été comme hiver.

## Déploiement Cloudflare

La base D1 `tcn-calendrier-2027` existe sur le compte Cloudflare, son schéma est appliqué et son
identifiant est dans `wrangler.jsonc`.

Par l'intégration GitHub de Cloudflare (Workers Builds) :

1. Tableau de bord Cloudflare → Workers & Pages → Créer → Importer un dépôt → `cldudouyt/tcn-calendrier-2027`.
2. Nom du projet : `tcn-calendrier-2027` · commande de build : `npm run build` · commande de déploiement :
   `npx wrangler deploy` · branche : `main`.
3. Paramètres du Worker → Variables et secrets → ajouter `ADMIN_TOKEN` avec le type **Secret**
   (16 caractères au moins). Une variable en texte clair serait lisible dans le tableau de bord.
4. Vérifier le site déployé (pages, PDF, carte, `/api/events`) avant de diffuser l'URL.

Ou en ligne de commande : `npx wrangler login`, `npx wrangler secret put ADMIN_TOKEN`,
`npm run build && npx wrangler deploy`.

Aucun secret ne doit être committé (`.dev.vars` et `.env*` sont ignorés par git).

## Points restant inconnus

- Aucun lieu de départ exact, aucun horaire ni règle d'emport du vélo confirmés.
- Duathlon des Sables du 28 mars 2027 : commune non confirmée, donc absent de la carte.
- Swimrun de Xanton (29 mai) et Triathlon de Nantes (17 octobre) : libellé et formats à confirmer.
- Olonne-sur-Mer est placée au centre de la commune des Sables-d'Olonne (commune déléguée).
