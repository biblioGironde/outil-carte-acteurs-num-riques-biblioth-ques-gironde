// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fauxFetch } from './aides.mjs';
import { verifierRegistre, verifierSite, verifierTout, rediger, STATUT } from '../scripts/verifier.mjs';

const registre = {
  '123456789': { siren: '123456789', nom_complet: 'ASSO ACTIVE', etat_administratif: 'A', siege: { siret: '12345678900012', etat_administratif: 'A' } },
  '987654321': { siren: '987654321', nom_complet: 'ASSO DISSOUTE', etat_administratif: 'C', date_fermeture: '2025-06-30', siege: { siret: '98765432100011', etat_administratif: 'F' } },
  '555555555': { siren: '555555555', nom_complet: 'ASSO MULTI', etat_administratif: 'A', siege: { siret: '55555555500010', etat_administratif: 'A' }, matching_etablissements: [{ siret: '55555555500028', etat_administratif: 'F' }] },
};

const fetchRegistre = fauxFetch((url) => {
  const q = new URL(url).searchParams.get('q');
  const r = registre[q] ?? Object.values(registre).find(() => false);
  if (q === 'W332000001') return { status: 200, json: { results: [{ siren: '111', etat_administratif: 'A', complements: { identifiant_association: 'W332000001' } }] } };
  return { status: 200, json: { results: r ? [r] : [] } };
});

test('registre : actif, cessé, établissement fermé, introuvable, non renseigné', async () => {
  assert.equal((await verifierRegistre({ siret: '12345678900012' }, fetchRegistre)).statut, STATUT.ACTIF);
  const cesse = await verifierRegistre({ siret: '98765432100011' }, fetchRegistre);
  assert.equal(cesse.statut, STATUT.CESSE);
  assert.match(cesse.detail, /2025-06-30|fermé/);
  assert.equal((await verifierRegistre({ siret: '55555555500028' }, fetchRegistre)).statut, STATUT.CESSE);
  assert.equal((await verifierRegistre({ siret: '00000000000000' }, fetchRegistre)).statut, STATUT.INTROUVABLE);
  assert.equal((await verifierRegistre({ rna: 'W332000001' }, fetchRegistre)).statut, STATUT.ACTIF);
  assert.equal((await verifierRegistre({}, fetchRegistre)).statut, STATUT.NON_RENSEIGNE);
});

test('site : en ligne, refus anti-robots, disparu', async () => {
  const f = fauxFetch((url, { method }) => {
    if (url.includes('ok')) return { status: method === 'HEAD' ? 405 : 200 };
    if (url.includes('robot')) return { status: 403 };
    return new TypeError('fetch failed');
  });
  assert.equal((await verifierSite('https://ok.example', f)).statut, STATUT.ACTIF);
  assert.equal((await verifierSite('https://robot.example', f)).statut, STATUT.ERREUR);
  assert.equal((await verifierSite('https://mort.example', f)).statut, STATUT.INTROUVABLE);
});

test('vérification complète : dates mises à jour, rapport classé, rien supprimé', async () => {
  const point = { type: 'Point', coordinates: [-0.58, 44.84] };
  const collection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: point, properties: { id: 'a', nom: 'Active', commune: 'Bordeaux', siret: '12345678900012', site: 'https://ok.example' } },
      { type: 'Feature', geometry: point, properties: { id: 'b', nom: 'Dissoute', commune: 'Blaye', siret: '98765432100011' } },
      { type: 'Feature', geometry: point, properties: { id: 'c', nom: 'Sans identifiant', commune: 'Langon' } },
    ],
  };
  // Registre simulé + sites toujours en ligne.
  const siteEnLigne = fauxFetch(() => ({ status: 200 }));
  const combine = (url, opts) => (String(url).includes('recherche-entreprises') ? fetchRegistre(url, opts) : siteEnLigne(url, opts));
  const resultats = await verifierTout(collection, { fetchFn: combine, aujourdhui: '2027-01-02' });

  assert.equal(collection.features.length, 3);
  assert.ok(collection.features.every((x) => x.properties.derniere_verification === '2027-01-02'));
  const parId = Object.fromEntries(resultats.map((r) => [r.id, r.conclusion]));
  assert.deepEqual(parId, { a: 'ok', b: 'a_retirer', c: 'a_verifier' });

  const rapport = rediger(resultats, { annee: 2027, depot: 'biblioGironde/outil-carte-acteurs-num-riques-biblioth-ques-gironde' });
  assert.match(rapport, /## Probablement fermés[\s\S]*Dissoute/);
  assert.match(rapport, /## À vérifier[\s\S]*Sans identifiant/);
  assert.match(rapport, /identifiant=b/);
  assert.doesNotMatch(rapport, /\*\*Active\*\*/);
});
