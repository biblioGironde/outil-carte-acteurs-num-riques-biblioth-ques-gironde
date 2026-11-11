# Carte des acteurs du territoire — Gironde

Carte interactive des structures associatives et institutionnelles de Gironde :
inclusion et médiation numérique, fablabs et tiers-lieux, éducation aux médias,
Promeneurs du Net, éducation populaire, musique, institutions.

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

1. Le dépôt est `biblioGironde/outil-carte-acteurs-num-riques-biblioth-ques-gironde`.
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

Colonnes `etiquettes` et `public` : plusieurs valeurs séparées par `|`. Les étiquettes acceptent le code
(`inclusion`, `fabrication`, `emi`, `pdn`, `educpop`, `musique`, `institutionnel`) ou le libellé.
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
| `specialite_musique` | si l'étiquette `musique` est présente |
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

### Licences

- **Code** (HTML, CSS, JavaScript, scripts, workflows) : © Département de la Gironde — biblio.gironde,
  sous licence **GNU Affero General Public License v3.0** (AGPL-3.0-or-later), voir [`LICENSE`](LICENSE).
  Vous pouvez réutiliser et modifier ce code ; toute version modifiée, redistribuée **ou mise en ligne**,
  doit être publiée sous la même licence, avec son code source.
- **Données** (`data/acteurs.geojson`, `data/etiquettes.json`) : **Licence Ouverte Etalab 2.0**
  (<https://www.etalab.gouv.fr/licence-ouverte-open-licence/>). Réutilisation libre, sous réserve de citer la source :
  « Carte des acteurs du territoire — biblio.gironde ».
