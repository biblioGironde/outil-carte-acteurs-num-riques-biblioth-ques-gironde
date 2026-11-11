// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lireCsv, decoder, importer, rapportImport, COLONNES } from '../scripts/importer-csv.mjs';
import { RACINE, validerCollection } from '../scripts/lib/referentiel.mjs';
import { collectionVide, geocodageFactice } from './aides.mjs';

const ENTETE = COLONNES.join(';');

test('le modèle contient exactement les colonnes attendues', () => {
  const modele = readFileSync(join(RACINE, 'docs', 'modele-import.csv'), 'utf8').trim();
  assert.equal(modele, ENTETE);
});

test('lecture CSV : point-virgule, guillemets, retours à la ligne, virgule détectée', () => {
  const l = lireCsv(`nom;description\n"Asso ""Le Lien""";"Ligne 1\nLigne 2; suite"\n\n`);
  assert.equal(l.length, 1);
  assert.equal(l[0].nom, 'Asso "Le Lien"');
  assert.equal(l[0].description, 'Ligne 1\nLigne 2; suite');
  assert.equal(lireCsv('nom,commune\nA,Blaye')[0].commune, 'Blaye');
});

test('décodage : UTF-8 avec BOM et fichier Excel en Windows-1252', () => {
  assert.equal(decoder(new Uint8Array([0xef, 0xbb, 0xbf, 0x63, 0xc3, 0xa9])), 'cé');
  assert.equal(decoder(new Uint8Array([0x63, 0xe9])), 'cé');
});

test('le fichier d’exemple est refusé ligne par ligne (lignes « Exemple »)', async () => {
  const lignes = lireCsv(readFileSync(join(RACINE, 'docs', 'exemple-import.csv'), 'utf8'));
  const r = await importer(lignes, collectionVide(), { geocoderFn: geocodageFactice });
  assert.equal(r.ajoutes.length, 0);
  assert.equal(r.refuses.length, 2);
});

test('import : étiquettes souples, champs mal formés ignorés, doublons et erreurs signalés', async () => {
  const csv = [
    ENTETE,
    'Fablab du Port;Fablabs & tiers-lieux|EMI;;Atelier ouvert.;12 rue des Bassins;33300;Bordeaux;;;fablab.example.org;pas-un-mail;;Hubikoop, Réseau fablabs;jeunesse|Inconnu;123;;https://source.example',
    'École de musique;musique;école de musique;Cours.;1 place;33500;Libourne;44,92;-0,24;;;;;;;;',
    'Fablab du Port;fabrication;;Doublon.;12 rue des Bassins;33300;Bordeaux;;;;;;;;;;',
    'Sans étiquette;;;Desc.;1 rue;33000;Bordeaux;;;;;;;;;;',
    'Mauvaise étiquette;cinéma;;Desc.;1 rue;33000;Bordeaux;;;;;;;;;;',
    'Introuvable;inclusion;;Desc.;1 rue;33000;Introuvable;;;;;;;;;;',
  ].join('\n');
  const collection = collectionVide();
  const r = await importer(lireCsv(csv), collection, { geocoderFn: geocodageFactice, aujourdhui: '2026-11-11', fichier: 'test.csv' });

  assert.deepEqual(r.ajoutes.map((a) => a.id), ['fablab-du-port-bordeaux', 'ecole-de-musique-libourne']);
  const fablab = collection.features[0].properties;
  assert.deepEqual(fablab.etiquettes, ['fabrication', 'emi']);
  assert.deepEqual(fablab.public, ['Jeunesse']);
  assert.deepEqual(fablab.reseaux, ['Hubikoop', 'Réseau fablabs']);
  assert.equal(fablab.site, 'https://fablab.example.org');
  assert.equal(fablab.email, undefined);
  assert.equal(fablab.siret, undefined);
  assert.equal(fablab.source, 'import test.csv');
  const musique = collection.features[1];
  assert.equal(musique.properties.specialite_musique, 'École de musique');
  assert.deepEqual(musique.geometry.coordinates, [-0.24, 44.92]);
  assert.deepEqual(validerCollection(collection), []);

  const refus = Object.fromEntries(r.refuses.map((x) => [x.ligne, x.erreurs.join(' ')]));
  assert.match(refus[4], /déjà présent/);
  assert.match(refus[5], /au moins une étiquette/);
  assert.match(refus[6], /étiquette inconnue « cinéma »/);
  assert.match(refus[7], /introuvable/i);

  const rapport = rapportImport(r, 'test.csv');
  assert.match(rapport, /2 acteur\(s\) ajouté\(s\)\*\*, 4 ligne\(s\) refusée\(s\)/);
  assert.match(rapport, /SIRET ignoré/);
  assert.match(rapport, /https:\/\/source\.example/);
});
