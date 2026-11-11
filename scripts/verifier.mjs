#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Vérification annuelle : chaque acteur existe-t-il toujours ?
//  - SIRET / RNA interrogés dans l'API Recherche d'entreprises (État) : structure active ou cessée ;
//  - site web : répond-il encore ?
// Ne supprime jamais rien : met à jour la date de vérification et produit un rapport
// (rapport-verification.md) publié en issue pour décision humaine.
//
// Usage : node scripts/verifier.mjs [--rapport chemin.md]

import { writeFileSync } from 'node:fs';
import { lireActeurs, ecrireActeurs } from './lib/referentiel.mjs';

const API_ENTREPRISES = 'https://recherche-entreprises.api.gouv.fr/search';
const DELAI_MS = 20000;
const PARALLELE = 4;
const AGENT = 'Mozilla/5.0 (compatible; verification-carte-acteurs; +https://github.com/biblioGironde/outil-carte-acteurs-num-riques-biblioth-ques-gironde)';

export const STATUT = {
  ACTIF: 'actif',
  CESSE: 'cessé',
  INTROUVABLE: 'introuvable',
  NON_RENSEIGNE: 'non renseigné',
  ERREUR: 'erreur',
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function requeteJson(url, fetchFn, essais = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(DELAI_MS) });
      if (r.status === 429 && i < essais) { await pause(2000 * i); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= essais) throw e;
      await pause(1500 * i);
    }
  }
}

/** Statut administratif via SIRET (prioritaire) ou numéro RNA. */
export async function verifierRegistre({ siret, rna }, fetchFn = fetch) {
  if (!siret && !rna) return { statut: STATUT.NON_RENSEIGNE };
  const identifiant = siret || rna;
  const url = new URL(API_ENTREPRISES);
  url.searchParams.set('q', siret ? siret.slice(0, 9) : rna);
  url.searchParams.set('per_page', '5');
  let donnees;
  try {
    donnees = await requeteJson(url, fetchFn);
  } catch (e) {
    return { statut: STATUT.ERREUR, detail: `registre injoignable (${e.message})` };
  }
  const resultats = donnees?.results ?? [];
  const unite = siret
    ? resultats.find((r) => r.siren === siret.slice(0, 9))
    : resultats.find((r) => r.complements?.identifiant_association === rna);
  if (!unite) return { statut: STATUT.INTROUVABLE, detail: `${identifiant} absent du registre` };

  // Si l'établissement précis (SIRET) est connu, on regarde son propre état.
  if (siret) {
    const etab = [unite.siege, ...(unite.matching_etablissements ?? [])].find((e) => e?.siret === siret);
    if (etab?.etat_administratif === 'F') {
      return { statut: STATUT.CESSE, detail: `établissement ${siret} fermé${etab.date_fermeture ? ` le ${etab.date_fermeture}` : ''}` };
    }
  }
  if (unite.etat_administratif === 'C') {
    return { statut: STATUT.CESSE, detail: `structure cessée${unite.date_fermeture ? ` le ${unite.date_fermeture}` : ''}` };
  }
  return { statut: STATUT.ACTIF, detail: unite.nom_complet };
}

/** Le site répond-il ? Les refus « anti-robots » (401/403/429) sont jugés incertains, pas en panne. */
export async function verifierSite(site, fetchFn = fetch) {
  if (!site) return { statut: STATUT.NON_RENSEIGNE };
  let derniereErreur;
  for (const methode of ['HEAD', 'GET']) {
    try {
      const r = await fetchFn(site, {
        method: methode, redirect: 'follow',
        headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(DELAI_MS),
      });
      if (r.ok) return { statut: STATUT.ACTIF };
      if ([401, 403, 429].includes(r.status)) return { statut: STATUT.ERREUR, detail: `accès refusé aux robots (HTTP ${r.status}), à vérifier à la main` };
      if (r.status === 405 && methode === 'HEAD') continue;
      derniereErreur = `HTTP ${r.status}`;
      if (methode === 'HEAD') continue;
    } catch (e) {
      derniereErreur = e.cause?.code || e.name || e.message;
    }
  }
  return { statut: STATUT.INTROUVABLE, detail: `site injoignable (${derniereErreur})` };
}

export function conclure(registre, site) {
  if (registre.statut === STATUT.CESSE) return 'a_retirer';
  if (registre.statut === STATUT.INTROUVABLE || site.statut === STATUT.INTROUVABLE) return 'a_verifier';
  if (registre.statut === STATUT.NON_RENSEIGNE && site.statut === STATUT.NON_RENSEIGNE) return 'a_verifier';
  if (registre.statut === STATUT.ERREUR || site.statut === STATUT.ERREUR) return 'incertain';
  return 'ok';
}

export async function verifierTout(collection, { fetchFn = fetch, aujourdhui = new Date().toISOString().slice(0, 10) } = {}) {
  const resultats = [];
  const file = [...collection.features];
  async function ouvrier() {
    while (file.length) {
      const f = file.shift();
      const p = f.properties;
      const [registre, site] = await Promise.all([verifierRegistre(p, fetchFn), verifierSite(p.site, fetchFn)]);
      const conclusion = conclure(registre, site);
      p.derniere_verification = aujourdhui;
      p.statut_verification = conclusion === 'ok' ? 'ok' : 'a_verifier';
      resultats.push({ id: p.id, nom: p.nom, commune: p.commune, registre, site, conclusion });
    }
  }
  await Promise.all(Array.from({ length: PARALLELE }, ouvrier));
  resultats.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return resultats;
}

export function rediger(resultats, { annee, depot } = {}) {
  const groupe = (c) => resultats.filter((r) => r.conclusion === c);
  const lien = (r) => depot
    ? `[proposer le retrait ou la correction](https://github.com/${depot}/issues/new?template=modification-acteur.yml&title=${encodeURIComponent(`[Modification] ${r.nom}`)}&identifiant=${encodeURIComponent(r.id)})`
    : '';
  const ligne = (r) => {
    const details = [r.registre.detail && `registre : ${r.registre.detail}`, r.site.detail && `site : ${r.site.detail}`]
      .filter(Boolean).join(' ; ');
    return `- [ ] **${r.nom}** (${r.commune}, \`${r.id}\`) — ${details || 'aucun SIRET/RNA ni site renseigné'} ${lien(r)}`.trim();
  };
  const sections = [
    `# Vérification annuelle ${annee ?? ''}`.trim(),
    '',
    `${resultats.length} acteur(s) vérifié(s) : ${groupe('ok').length} sans problème, ${groupe('a_retirer').length} probablement fermé(s), ${groupe('a_verifier').length} à vérifier, ${groupe('incertain').length} incertain(s).`,
    '',
    'Rien n’a été supprimé automatiquement. Cochez chaque ligne une fois traitée, puis fermez cette issue.',
  ];
  const bloc = (titre, aide, liste) => {
    if (!liste.length) return;
    sections.push('', `## ${titre}`, '', aide, '', ...liste.map(ligne));
  };
  bloc('Probablement fermés', 'Le registre de l’État indique une cessation d’activité.', groupe('a_retirer'));
  bloc('À vérifier', 'Identifiant absent du registre, site injoignable, ou aucun moyen de vérification renseigné (ajoutez un SIRET).', groupe('a_verifier'));
  bloc('Incertains', 'Le registre ou le site n’a pas pu être interrogé (refus anti-robots, panne passagère).', groupe('incertain'));
  return sections.join('\n') + '\n';
}

async function principal() {
  const i = process.argv.indexOf('--rapport');
  const cheminRapport = i > -1 ? process.argv[i + 1] : 'rapport-verification.md';
  const collection = lireActeurs();
  const resultats = await verifierTout(collection);
  ecrireActeurs(collection);
  const rapport = rediger(resultats, { annee: new Date().getFullYear(), depot: process.env.GITHUB_REPOSITORY });
  writeFileSync(cheminRapport, rapport);
  console.log(rapport);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
