#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Contrôle la cohérence de data/acteurs.geojson. Usage : node scripts/valider.mjs [fichier]
import { lireActeurs, validerCollection, FICHIER_ACTEURS } from './lib/referentiel.mjs';

const fichier = process.argv[2] ?? FICHIER_ACTEURS;
let collection;
try {
  collection = lireActeurs(fichier);
} catch (e) {
  console.error(`Fichier illisible (${fichier}) : ${e.message}`);
  process.exit(1);
}
const erreurs = validerCollection(collection);
if (erreurs.length) {
  console.error(`${erreurs.length} problème(s) dans ${fichier} :`);
  for (const e of erreurs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`${collection.features.length} acteur(s), données valides.`);
