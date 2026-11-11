// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corpsIssue, collectionVide, geocodageFactice } from './aides.mjs';
import {
  traiterFormulaire, ErreurFormulaire, ACTION_MODIFIER, ACTION_RETIRER,
} from '../scripts/issue-vers-acteur.mjs';
import { lireFormulaire } from '../scripts/lib/formulaire.mjs';
import { CHAMPS, validerCollection } from '../scripts/lib/referentiel.mjs';

const CONFIRMATION = ['Je ne saisis que des informations publiques sur la structure, aucune donnée personnelle.'];

const ajoutValide = {
  nom: 'Fablab du Port',
  etiquettes: ['Fabrication numérique (fablabs, tiers-lieux)', "Éducation aux médias et à l'information"],
  description: 'Atelier de fabrication numérique ouvert à tous.\nImpression 3D, découpe laser.',
  adresse: '12 rue des Bassins',
  code_postal: '33300',
  commune: 'Bordeaux',
  site: 'fablab-du-port.example.org',
  email: 'contact@fablab-du-port.example.org',
  reseaux: 'Réseau des fablabs, Hubikoop',
  public: ['Jeunesse', 'Tout public'],
  siret: '123 456 789 00012',
  confirmation: CONFIRMATION,
};

async function ajouter(collection, valeurs, numero = 1) {
  return traiterFormulaire({
    titre: `[Ajout] ${valeurs.nom}`,
    corps: corpsIssue('ajout-acteur.yml', valeurs),
    numero, collection, aujourdhui: '2026-11-11', geocoderFn: geocodageFactice,
  });
}

test('le lecteur retrouve chaque champ du formulaire généré', () => {
  const corps = corpsIssue('ajout-acteur.yml', ajoutValide);
  const saisie = lireFormulaire(corps, CHAMPS);
  assert.equal(saisie.nom, 'Fablab du Port');
  assert.deepEqual(saisie.public, ['Jeunesse', 'Tout public']);
  assert.equal(saisie.coordonnees, undefined, 'les champs vides sont ignorés');
});

test('ajout complet : fiche normalisée et géolocalisée', async () => {
  const { collection, resume } = await ajouter(collectionVide(), ajoutValide, 42);
  assert.equal(resume.action, 'ajout');
  assert.equal(resume.id, 'fablab-du-port-bordeaux');
  const p = collection.features[0].properties;
  assert.deepEqual(p.etiquettes, ['fabrication', 'emi']);
  assert.deepEqual(p.reseaux, ['Réseau des fablabs', 'Hubikoop']);
  assert.equal(p.site, 'https://fablab-du-port.example.org');
  assert.equal(p.siret, '12345678900012');
  assert.equal(p.description, 'Atelier de fabrication numérique ouvert à tous. Impression 3D, découpe laser.');
  assert.equal(p.source, 'formulaire #42');
  assert.equal(p.date_ajout, '2026-11-11');
  assert.deepEqual(collection.features[0].geometry.coordinates, [-0.5792, 44.8378]);
  assert.deepEqual(validerCollection(collection), []);
});

test('coordonnées saisies à la main : pas de géocodage', async () => {
  const { collection } = await traiterFormulaire({
    titre: '[Ajout] X',
    corps: corpsIssue('ajout-acteur.yml', { ...ajoutValide, coordonnees: '44,9, -0,25' }),
    collection: collectionVide(),
    geocoderFn: () => { throw new Error('ne doit pas être appelé'); },
  });
  assert.deepEqual(collection.features[0].geometry.coordinates, [-0.25, 44.9]);
});

test('ajout refusé : erreurs listées en clair', async () => {
  await assert.rejects(
    ajouter(collectionVide(), { ...ajoutValide, etiquettes: [], code_postal: '75001', siret: '123', confirmation: [] }),
    (e) => {
      assert.ok(e instanceof ErreurFormulaire);
      const texte = e.erreurs.join('\n');
      assert.match(texte, /confirmation/);
      return true;
    },
  );
  await assert.rejects(
    ajouter(collectionVide(), { ...ajoutValide, etiquettes: [], code_postal: '75001', siret: '123' }),
    (e) => {
      const texte = e.erreurs.join('\n');
      assert.match(texte, /au moins une étiquette/);
      assert.match(texte, /hors Gironde/);
      assert.match(texte, /SIRET invalide/);
      return true;
    },
  );
});

test('spécialité musicale sans étiquette Musique : refusé', async () => {
  await assert.rejects(ajouter(collectionVide(), { ...ajoutValide, specialite_musique: 'École de musique' }), /Musique/);
});

test('doublon nom + commune : renvoie vers la modification', async () => {
  const { collection } = await ajouter(collectionVide(), ajoutValide);
  await assert.rejects(ajouter(collection, ajoutValide), /existe déjà/);
});

test('géocodage impossible : message transmis', async () => {
  await assert.rejects(ajouter(collectionVide(), { ...ajoutValide, commune: 'Introuvable' }), /Adresse introuvable/);
});

test('modification : seuls les champs remplis changent, « - » vide un champ', async () => {
  const { collection } = await ajouter(collectionVide(), ajoutValide);
  const { collection: apres, resume } = await traiterFormulaire({
    titre: '[Modification] Fablab du Port',
    corps: corpsIssue('modification-acteur.yml', {
      identifiant: 'fablab-du-port-bordeaux', action: ACTION_MODIFIER,
      telephone: '05 56 00 00 00', email: '-', etiquettes: ['Musique'], specialite_musique: 'Musiques actuelles',
    }),
    collection, aujourdhui: '2026-12-01', geocoderFn: geocodageFactice,
  });
  assert.equal(resume.action, 'modification');
  const p = apres.features[0].properties;
  assert.equal(p.telephone, '05 56 00 00 00');
  assert.equal(p.email, undefined);
  assert.deepEqual(p.etiquettes, ['musique']);
  assert.equal(p.nom, 'Fablab du Port');
  assert.equal(p.date_modification, '2026-12-01');
});

test('modification : identifiant inconnu ou champ obligatoire vidé', async () => {
  const { collection } = await ajouter(collectionVide(), ajoutValide);
  const base = { titre: '[Modification] ?', collection, geocoderFn: geocodageFactice };
  await assert.rejects(traiterFormulaire({ ...base, corps: corpsIssue('modification-acteur.yml', { identifiant: 'nexiste-pas', action: ACTION_MODIFIER, telephone: '1' }) }), /Aucun acteur/);
  await assert.rejects(traiterFormulaire({ ...base, corps: corpsIssue('modification-acteur.yml', { identifiant: 'fablab-du-port-bordeaux', action: ACTION_MODIFIER, commune: '-' }) }), /obligatoire/);
});

test('modification par le nom exact, avec nouvelle adresse regéocodée', async () => {
  const { collection } = await ajouter(collectionVide(), ajoutValide);
  let appels = 0;
  const { collection: apres } = await traiterFormulaire({
    titre: '[Modification] Fablab du Port',
    corps: corpsIssue('modification-acteur.yml', { identifiant: 'Fablab du Port', action: ACTION_MODIFIER, adresse: '1 place Neuve' }),
    collection,
    geocoderFn: async () => { appels++; return { lat: 44.9, lon: -0.6 }; },
  });
  assert.equal(appels, 1);
  assert.deepEqual(apres.features[0].geometry.coordinates, [-0.6, 44.9]);
});

test('retrait : motif obligatoire, puis acteur supprimé', async () => {
  const { collection } = await ajouter(collectionVide(), ajoutValide);
  const corpsSansMotif = corpsIssue('modification-acteur.yml', { identifiant: 'fablab-du-port-bordeaux', action: ACTION_RETIRER });
  await assert.rejects(traiterFormulaire({ titre: '[Modification] x', corps: corpsSansMotif, collection }), /motif/);
  const { collection: apres, resume } = await traiterFormulaire({
    titre: '[Modification] x',
    corps: corpsIssue('modification-acteur.yml', { identifiant: 'fablab-du-port-bordeaux', action: ACTION_RETIRER, motif: 'Association dissoute en 2026' }),
    collection,
  });
  assert.equal(resume.action, 'retrait');
  assert.equal(apres.features.length, 0);
});

test('titre sans préfixe : refusé', async () => {
  await assert.rejects(traiterFormulaire({ titre: 'Bonjour', corps: '', collection: collectionVide() }), ErreurFormulaire);
});
