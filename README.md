# Acteurs du numérique culturel et citoyen en Gironde

Carte interactive des structures associatives et institutionnelles de Gironde :
inclusion et médiation numérique, fablabs et tiers-lieux, éducation aux médias,
Promeneurs du Net, éducation populaire, musique, Micro-Folies, jeu vidéo, numérique responsable, bibliothèques numériques, institutions.

- **Carte** : page statique (GitHub Pages + Leaflet + OpenStreetMap), aucune base de données ni serveur.
- **Données** : un seul fichier, `data/acteurs.geojson`, versionné dans ce dépôt.
- **Saisie** : formulaires GitHub (onglet *Issues*), réservés aux collaborateurs du dépôt.
- **Contrôle annuel** : tâche automatique qui vérifie chaque année que les structures existent toujours.

## Fonctionnement

```
Collaborateur ── formulaire (issue) ──▶ Action « Formulaire → PR »
                                          ├─ auteur collaborateur ?   sinon : commentaire, rien n'est modifié
                                          ├─ contrôle des champs      sinon : commentaire listant les erreurs
                                          ├─ géolocalisation de l'adresse (Géoplateforme IGN)
                                          └─ pull request ──▶ relecture humaine ──▶ fusion ──▶ carte à jour
```

La fusion de la pull request ferme automatiquement l'issue d'origine.
Corriger une issue (menu « … » → *Edit*) relance le traitement et met à jour la même pull request.

## Mise en place (une seule fois)

1. Le dépôt est `biblioGironde/outil-carte-acteurs-numeriques-bibliotheques-gironde`.
   Si le nom ou l'organisation change, modifier la balise `<meta name="depot">` de `index.html`.
2. **Settings → Pages** : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
3. **Settings → Actions → General → Workflow permissions** :
   cocher *Read and write permissions* **et** *Allow GitHub Actions to create and approve pull requests*.
4. **Settings → Collaborators and teams** : ajouter les collaborateurs avec le rôle *Triage*
   (formulaires seulement) ou *Write* (formulaires et import de fichiers CSV).
5. **Settings → Rules → Rulesets** : protéger `main` (voir ci-dessous).

### Ruleset « Protection de main »

*Settings → Rules → Rulesets → New ruleset → New branch ruleset*

| Réglage | Valeur |
| --- | --- |
| Ruleset name | Protection de main |
| Enforcement status | Active |
| Bypass list | *Repository admin*, en mode *Always allow* |
| Target branches | *Include default branch* |
| Restrict deletions | coché |
| Block force pushes | coché |
| Require a pull request before merging | coché, *Required approvals* : 0 |
| Allowed merge methods | *Squash* (un commit lisible par ajout ou import) |

Rien n'arrive donc sur `main`, et sur la carte, sans pull request fusionnée par un administrateur.
Tous les automatismes (formulaires, import CSV, vérification annuelle) passent par des pull requests :
aucun n'a besoin de contourner la règle.

Les vérifications automatiques (« Validation des données ») ne sont pas rendues obligatoires :
GitHub ne les lance pas sur les pull requests ouvertes par les automatismes, ce qui bloquerait
leur fusion. Les scripts valident de toute façon les données avant d'ouvrir chaque pull request.

## Ajouter, modifier, retirer un acteur

- **Ajouter** : bouton « Proposer un acteur » de la carte, ou *Issues → New issue → Ajouter un acteur*.
  Compléter le titre après `[Ajout]`.
- **Modifier ou retirer** : lien « Proposer une modification » en bas de la fiche de l'acteur
  (l'identifiant est prérempli). Ne remplir que les champs qui changent ; écrire `-` pour vider un champ facultatif.
- **Valider** : ouvrir la pull request, vérifier la fiche dans *Files changed*, puis *Merge*.
  La carte est à jour une à deux minutes après la fusion.

Si l'adresse n'est pas reconnue, indiquer les coordonnées GPS (« latitude, longitude ») dans le formulaire.

**Données personnelles** : ne saisir que des informations publiques sur la structure.
Courriel générique uniquement (contact@…), jamais de nom de personne.

## Import en lot (fichier CSV)

Pour la première alimentation, plusieurs acteurs peuvent être ajoutés d'un coup :

1. Remplir un fichier sur le modèle [`docs/modele-import.csv`](docs/modele-import.csv)
   (exemple commenté : [`docs/exemple-import.csv`](docs/exemple-import.csv)).
   Pour le faire préparer par Copilot ou Claude, utiliser la consigne [`docs/consigne-ia.md`](docs/consigne-ia.md).
2. Le déposer dans le dossier [`import/`](import/) : *Add file → Upload files*, puis
   *Create a new branch for this commit and start a pull request* et *Propose changes*.
3. Le workflow « Import CSV » contrôle chaque ligne, géolocalise les adresses, retire le fichier du dossier,
   ajoute le résultat à la même branche et ouvre la pull request (ou la complète) avec le rapport :
   acteurs ajoutés, champs ignorés, lignes refusées et pourquoi.

Colonnes `etiquettes`, `activites_musique`, `services_bibliotheque` et `public` : plusieurs valeurs séparées par `|`. Les étiquettes acceptent le code
(`inclusion`, `fabrication`, `emi`, `pdn`, `educpop`, `musique`, `microfolie`, `jeuvideo`, `numresp`, `bibliotheque`, `institutionnel`) ou le libellé ;
les activités musicales aussi (`label`, `diffusion`, `studio`… voir `docs/consigne-ia.md`), ainsi que le vocabulaire
de l'annuaire du RIM (« Booking / tour », « Cafés-culture »…). Les activités de bibliothèque : `fabrication` (fablab), `mediation`
(médiation numérique régulière) et `inclusion` (lieu référencé sur la cartographie nationale des lieux d'inclusion numérique).
Séparateur `;` ou `,`, encodage UTF-8 ou celui d'Excel : les deux sont reconnus.
Un SIRET, un RNA, un courriel ou un site mal formé est ignoré sans bloquer la ligne.

Les informations trouvées par une IA doivent être relues avant fusion : la colonne `source_web`, reprise dans
le rapport, indique où les vérifier.

## Vérification annuelle

Le workflow `verification-annuelle.yml` vérifie chaque acteur en **janvier** (modifiable : `MOIS_VERIFICATION`) :

- le **SIRET** (ou à défaut le numéro **RNA**) est interrogé dans l'API Recherche d'entreprises de l'État
  pour savoir si la structure est active ou cessée ;
- le **site web** est testé.

Il ne supprime rien : il enregistre la date de vérification et ouvre une issue « Vérification annuelle AAAA »
qui classe les acteurs en *probablement fermés*, *à vérifier* et *incertains*, avec un lien prérempli
pour proposer le retrait. **Renseigner le SIRET** de chaque acteur rend ce contrôle fiable.

Lancement manuel à tout moment : *Actions → Vérification annuelle des acteurs → Run workflow*.

> GitHub met en pause les tâches planifiées d'un dépôt public après 60 jours sans activité.
> Le workflow tourne donc chaque mois pour se réactiver, et ne fait la vérification complète que le mois choisi.
> Si un bandeau signale malgré tout qu'il est désactivé, le réactiver depuis l'onglet *Actions*.

## Calque des communes

Le bouton « Communes » de la carte affiche les limites des 534 communes de Gironde
(fichier `data/communes-gironde.geojson`, chargé seulement à la demande). Au survol, une info-bulle
donne le nom de la commune et le nombre d'acteurs affichés (selon les filtres en cours) ;
un clic cadre la carte sur la commune. Les communes qui comptent au moins un acteur affiché sont légèrement teintées.
Le calque est mémorisé dans l'adresse de la page (`?communes=1`).

Source : contours de l'API Découpage administratif (geo.api.gouv.fr, d'après IGN Admin Express), simplifiés.

Le bouton « Population » teinte chaque commune selon sa population municipale INSEE (populations légales,
via geo.api.gouv.fr ; propriété `population` du même fichier), en 6 classes : moins de 1 000, 1 000 à 1 999,
2 000 à 4 999, 5 000 à 9 999, 10 000 à 49 999, 50 000 habitants et plus. Une légende s'affiche sous le bouton
et l'info-bulle donne le nombre d'habitants. Mémorisé dans l'adresse (`?population=1`), combinable avec « Communes ».
Le bouton « Densité » teinte les communes selon leur densité (habitants par km² : population / `surface_km2`,
surface issue de geo.api.gouv.fr), sur une rampe orange en 6 classes : moins de 25, 25 à 49, 50 à 99, 100 à 249,
250 à 999, 1 000 hab./km² et plus (`?densite=1`). Population et densité s'excluent : un seul remplissage à la fois.
Le bouton « Niveau de vie » teinte les communes selon le niveau de vie médian de leurs habitants (revenu disponible
par unité de consommation, INSEE Filosofi 2023, propriété `niveau_vie_median`), rampe violette en 6 classes :
moins de 22 000 €, puis par tranches de 2 000 € jusqu'à 30 000 € et plus (médiane de la Gironde : 26 820 €), `?niveau=1`.
Le taux de pauvreté (`taux_pauvrete`, seuil de 60 % de la médiane) s'affiche dans l'info-bulle quand il est diffusé
(communes d'au moins 2 000 habitants environ). Les communes sans donnée (secret statistique) sont en gris.
Source : « Indicateurs sur les revenus et la pauvreté au niveau local en 2023 », fichier `FILOSOFI_CC_csv.zip`
(<https://www.insee.fr/fr/statistiques/8984752>), indicateurs `MED_SL` et `PR_MD60`.
Pour actualiser les chiffres : reprendre `population` et `surface` (en hectares, à diviser par 100) de
`https://geo.api.gouv.fr/departements/33/communes?fields=code,population,surface`.
Pour les mettre à jour (fusions de communes au 1er janvier) :

```sh
curl -o contours.geojson "https://geo.api.gouv.fr/departements/33/communes?fields=nom,code&format=geojson&geometry=contour"
npx mapshaper contours.geojson -filter-fields nom,code -simplify 12% keep-shapes \
  -o precision=0.00001 format=geojson data/communes-gironde.geojson
```

## Étiquettes

Elles sont définies dans `data/etiquettes.json` (identifiant, libellé, couleur), tout comme les spécialités
musicales et les publics. Après toute modification :

```sh
node scripts/generer-formulaires.mjs   # régénère les formulaires .github/ISSUE_TEMPLATE/*.yml
```

Ne pas changer l'`id` d'une étiquette déjà utilisée (ou mettre à jour les acteurs concernés).

## Structure des données

Chaque acteur est un point GeoJSON dont les propriétés sont :

| Propriété | Contenu |
|---|---|
| `id` | identifiant stable, généré à partir du nom et de la commune |
| `nom`, `description`, `adresse`, `code_postal`, `commune` | obligatoires |
| `etiquettes` | liste d'identifiants de `data/etiquettes.json` (au moins un) |
| `domaine_musique` | un domaine, si l'étiquette `musique` est présente |
| `activites_musique` | liste d'activités (`data/etiquettes.json`), si l'étiquette `musique` est présente |
| `services_bibliotheque` | « Fabrication », « Médiation numérique régulière », « Inclusion numérique », si l'étiquette `bibliotheque` est présente |
| `site`, `email`, `telephone` | contacts de la structure |
| `reseaux`, `public` | listes |
| `siret`, `rna` | identifiants pour la vérification annuelle |
| `date_ajout`, `date_modification`, `derniere_verification`, `statut_verification`, `source` | renseignés automatiquement |

Une modification directe du fichier est possible (pull request classique) : le workflow
« Validation des données » contrôle alors le fichier.

## Développement

Node.js 20 ou plus, sans dépendance.

```sh
node --test "tests/*.test.mjs"   # tests
node scripts/valider.mjs         # contrôle de data/acteurs.geojson
python3 -m http.server           # aperçu local sur http://localhost:8000
```

Pour un aperçu avec des données fictives : copier `tests/fixtures/exemple.geojson` vers `data/acteurs.geojson`
(sans le committer).

## Sources et licences

- Fond de carte © contributeurs OpenStreetMap ; bibliothèque Leaflet.
- Géolocalisation : service de géocodage de la Géoplateforme (IGN).
- Vérification : API Recherche d'entreprises (data.gouv.fr).
- Limites communales : API Découpage administratif (geo.api.gouv.fr), IGN Admin Express, Licence Ouverte.

### Licences

- **Code** (HTML, CSS, JavaScript, scripts, workflows) : © Département de la Gironde — biblio.gironde,
  sous licence **GNU Affero General Public License v3.0** (AGPL-3.0-or-later), voir [`LICENSE`](LICENSE).
  Vous pouvez réutiliser et modifier ce code ; toute version modifiée, redistribuée **ou mise en ligne**,
  doit être publiée sous la même licence, avec son code source.
- **Données** (`data/acteurs.geojson`, `data/etiquettes.json`, `data/communes-gironde.geojson`) : **Licence Ouverte Etalab 2.0**
  (<https://www.etalab.gouv.fr/licence-ouverte-open-licence/>). Réutilisation libre, sous réserve de citer la source :
  « Acteurs du numérique culturel et citoyen en Gironde — biblio.gironde ».
- **Bibliothèques numériques** : fiches établies à partir de la [cartographie nationale des lieux d'inclusion numérique](https://cartographie.societenumerique.gouv.fr)
  (données ouvertes sur data.gouv.fr, Licence Ouverte ; activité « Inclusion numérique ») et du rapport annuel d'activité 2025 des bibliothèques (fablab déclaré ;
  médiation numérique « régulière » = au moins 10 actions dans l'année, tous publics et enfants confondus).
