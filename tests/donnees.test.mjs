// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { lireActeurs, validerCollection, RACINE, ETIQUETTES } from '../scripts/lib/referentiel.mjs';
import { lireGabarit } from './aides.mjs';

test('data/acteurs.geojson est valide', () => {
  assert.deepEqual(validerCollection(lireActeurs()), []);
});

test('le jeu d’exemple des tests est valide', () => {
  assert.deepEqual(validerCollection(lireActeurs(join(RACINE, 'tests', 'fixtures', 'exemple.geojson'))), []);
});

test('les étiquettes du formulaire correspondent au référentiel', () => {
  const champ = lireGabarit('ajout-acteur.yml').find((c) => c.id === 'etiquettes');
  assert.deepEqual(champ.options, ETIQUETTES.map((e) => e.libelle));
});

test('le validateur repère les erreurs courantes', () => {
  const erreurs = validerCollection({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: { id: 'x', nom: 'X', etiquettes: ['inconnue'], description: 'd', adresse: 'a', code_postal: '33000', commune: 'c', site: 'pas une url' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-0.5, 44.8] }, properties: { id: 'x', nom: 'Y', etiquettes: ['musique'], description: 'd', adresse: 'a', code_postal: '33000', commune: 'c' } },
    ],
  });
  const texte = erreurs.join('\n');
  assert.match(texte, /étiquette inconnue/);
  assert.match(texte, /hors Gironde/);
  assert.match(texte, /site invalide/);
  assert.match(texte, /double/);
});
