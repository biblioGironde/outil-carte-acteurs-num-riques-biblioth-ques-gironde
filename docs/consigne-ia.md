# Consigne à donner à Copilot ou Claude pour préparer un fichier d'import

Copiez le texte ci-dessous dans Copilot ou Claude, puis complétez la dernière ligne.
L'assistant doit pouvoir faire des recherches sur le web (Copilot avec la recherche web,
Claude avec la recherche web activée).

---

Tu m'aides à recenser des structures de Gironde pour une carte publique des acteurs du territoire
(numérique, éducation aux médias, éducation populaire, musique, institutions).

Produis un fichier CSV séparé par des points-virgules, avec exactement cette ligne d'en-tête :

```
nom;etiquettes;specialite_musique;description;adresse;code_postal;commune;latitude;longitude;site;email;telephone;reseaux;public;siret;rna;source_web
```

Règles à respecter strictement :

1. Une ligne par structure, uniquement en Gironde (code postal commençant par 33).
2. N'invente rien. Chaque structure doit exister aujourd'hui. Dans `source_web`, indique l'adresse de la page
   où tu as vérifié ses informations. Si une information est introuvable, laisse la case vide.
3. Aucune donnée personnelle : pas de nom de personne, pas de courriel nominatif (seulement contact@,
   accueil@, info@…), pas de numéro de portable personnel.
4. `etiquettes` : un ou plusieurs de ces codes, séparés par `|` :
   `inclusion` (inclusion et médiation numérique), `fabrication` (fablabs, tiers-lieux, repair cafés),
   `emi` (éducation aux médias et à l'information), `pdn` (Promeneurs du Net), `educpop` (éducation populaire),
   `musique`, `institutionnel`.
5. `specialite_musique`, seulement avec l'étiquette `musique` : `Musiques actuelles`, `École de musique`,
   `Musiques de répertoire et de création` ou `Autre`.
6. `public` : un ou plusieurs parmi `Jeunesse`, `Familles`, `Tout public`, `Seniors`, `Professionnels`,
   séparés par `|`.
7. `description` : 1 à 3 phrases rédigées par toi (pas de copier-coller), 500 caractères maximum :
   ce que fait la structure et pour qui.
8. `adresse` : numéro et rue seulement ; `code_postal` et `commune` dans leurs colonnes.
9. `siret` : 14 chiffres sans espace, seulement si tu l'as trouvé sur annuaire-entreprises.data.gouv.fr
   ou sur le site de la structure. `rna` : W suivi de 9 chiffres. Sinon, laisse vide.
10. `latitude` et `longitude` : laisse vide, la carte géolocalise l'adresse.
11. `reseaux` : réseaux d'appartenance (Hubikoop, Promeneurs du Net Gironde, RIM…), séparés par des virgules.
12. Mets entre guillemets tout champ qui contient un point-virgule.

Donne le résultat dans un bloc de code CSV, puis, sous le bloc, la liste des structures ou des informations
dont tu n'es pas sûr.

Structures à recenser : [décrivez ici ce que vous cherchez, par exemple « les fablabs et repair cafés
du Libournais » ou collez une liste de noms]
