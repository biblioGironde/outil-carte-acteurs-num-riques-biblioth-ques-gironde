#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Import en lot d'acteurs depuis un fichier CSV (modèle : docs/modele-import.csv).
// Chaque ligne est contrôlée et géolocalisée ; les lignes refusées sont listées dans le rapport.
//
// Usage : node scripts/importer-csv.mjs import/fichier.csv [--rapport rapport-import.md]

import { readFileSync, appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  REFERENTIEL, ETIQUETTES, lireActeurs, ecrireActeurs, validerActeur, slugifier, idUnique,
} from './lib/referentiel.mjs';
import { geocoder, lireCoordonnees } from './lib/geocodage.mjs';
import { versProprietes, ordonner } from './issue-vers-acteur.mjs';

export const COLONNES = [
  'nom', 'etiquettes', 'specialite_musique', 'description', 'adresse', 'code_postal', 'commune',
  'latitude', 'longitude', 'site', 'email', 'telephone', 'reseaux', 'public', 'siret', 'rna', 'source_web',
];
const OBLIGATOIRES = ['nom', 'etiquettes', 'description', 'adresse', 'code_postal', 'commune'];
const LIBELLES = { nom: 'nom de la structure', etiquettes: 'au moins une étiquette', description: 'description courte', adresse: 'adresse', code_postal: 'code postal', commune: 'commune' };

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Décode le fichier : UTF-8 (avec ou sans BOM), sinon Windows-1252 (CSV enregistré par Excel). */
export function decoder(octets) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

/** Lecture CSV (guillemets, retours à la ligne dans les champs ; séparateur ; ou , détecté). */
export function lireCsv(texte) {
  const premiere = texte.split(/\r?\n/, 1)[0];
  const sep = (premiere.match(/;/g)?.length ?? 0) >= (premiere.match(/,/g)?.length ?? 0) ? ';' : ',';
  const lignes = [];
  let ligne = [];
  let champ = '';
  let entreGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') entreGuillemets = false;
      else champ += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some((v) => v.trim() !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((v) => v.trim() !== '')) lignes.push(ligne);
  if (!lignes.length) return [];
  const entetes = lignes[0].map((e) => norm(e).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return lignes.slice(1).map((valeurs, i) => {
    const o = { _ligne: i + 2 };
    entetes.forEach((e, j) => { o[e] = (valeurs[j] ?? '').trim(); });
    return o;
  });
}

const liste = (v) => String(v ?? '').split(/[|,;\n]/).map((s) => s.trim()).filter(Boolean);

const indexEtiquettes = new Map();
for (const e of ETIQUETTES) for (const k of [e.id, e.libelle, e.court]) indexEtiquettes.set(norm(k), e.libelle);
// formulations courantes
for (const [k, id] of [['emi', 'emi'], ['education aux medias', 'emi'], ['fablab', 'fabrication'], ['tiers-lieu', 'fabrication'],
  ['tiers-lieux', 'fabrication'], ['mediation numerique', 'inclusion'], ['promeneur du net', 'pdn'], ['education populaire', 'educpop']]) {
  indexEtiquettes.set(k, ETIQUETTES.find((e) => e.id === id).libelle);
}
const indexPublics = new Map(REFERENTIEL.publics.map((p) => [norm(p), p]));
const indexSpecialites = new Map(REFERENTIEL.specialites_musique.map((s) => [norm(s), s]));

/** Transforme une ligne CSV en propriétés, avec erreurs bloquantes et avertissements. */
export function lireLigne(l) {
  const erreurs = [];
  const avertissements = [];
  for (const c of OBLIGATOIRES) if (!l[c]) erreurs.push(`colonne « ${c} » vide (${LIBELLES[c]})`);
  if (/^exemple\b/i.test(l.nom ?? '')) erreurs.push('ligne d’exemple du modèle');

  const etiquettes = [];
  for (const brut of liste(l.etiquettes)) {
    const libelle = indexEtiquettes.get(norm(brut));
    if (libelle) etiquettes.push(libelle);
    else erreurs.push(`étiquette inconnue « ${brut} »`);
  }
  const publics = [];
  for (const brut of liste(l.public)) {
    const p = indexPublics.get(norm(brut));
    if (p) publics.push(p); else avertissements.push(`public ignoré « ${brut} »`);
  }
  const saisie = {
    nom: l.nom, description: l.description, adresse: l.adresse,
    code_postal: (l.code_postal ?? '').replace(/\D/g, '').padStart(5, '0'), commune: l.commune,
  };
  if (etiquettes.length) saisie.etiquettes = [...new Set(etiquettes)];
  if (publics.length) saisie.public = [...new Set(publics)];
  if (l.specialite_musique) {
    const s = indexSpecialites.get(norm(l.specialite_musique));
    if (s) saisie.specialite_musique = s; else avertissements.push(`spécialité ignorée « ${l.specialite_musique} »`);
  }
  for (const c of ['site', 'email', 'telephone', 'reseaux', 'siret', 'rna']) if (l[c]) saisie[c] = l[c];

  const p = versProprietes(saisie);
  // Champs facultatifs mal formés : on les retire au lieu de refuser la ligne.
  if (p.siret && !/^\d{14}$/.test(p.siret)) { avertissements.push(`SIRET ignoré « ${l.siret} » (14 chiffres attendus)`); delete p.siret; }
  if (p.rna && !/^W\d{9}$/.test(p.rna)) { avertissements.push(`RNA ignoré « ${l.rna} »`); delete p.rna; }
  if (p.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(p.email)) { avertissements.push(`courriel ignoré « ${l.email} »`); delete p.email; }
  if (p.site && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(p.site)) { avertissements.push(`site ignoré « ${l.site} »`); delete p.site; }
  if (p.specialite_musique && !p.etiquettes?.includes('musique')) {
    avertissements.push('spécialité musicale ignorée (pas d’étiquette Musique)'); delete p.specialite_musique;
  }
  if (p.description && p.description.length > 500) {
    avertissements.push('description coupée à 500 caractères');
    p.description = p.description.slice(0, 497).replace(/\s+\S*$/, '') + '…';
  }
  return { proprietes: p, erreurs, avertissements };
}

export async function importer(lignes, collection, {
  geocoderFn = geocoder, aujourdhui = new Date().toISOString().slice(0, 10), fichier = 'import',
} = {}) {
  const ids = new Set(collection.features.map((f) => f.properties.id));
  const deja = new Set(collection.features.map((f) => `${slugifier(f.properties.nom)}|${slugifier(f.properties.commune)}`));
  const ajoutes = [];
  const refuses = [];
  const avertis = [];

  for (const l of lignes) {
    const { proprietes, erreurs, avertissements } = lireLigne(l);
    const cle = `${slugifier(proprietes.nom ?? '')}|${slugifier(proprietes.commune ?? '')}`;
    if (!erreurs.length && deja.has(cle)) erreurs.push('déjà présent sur la carte (même nom et même commune)');

    let coordonnees;
    if (!erreurs.length) {
      try {
        if (l.latitude && l.longitude) {
          const { lat, lon } = lireCoordonnees(`${l.latitude} ${l.longitude}`);
          coordonnees = [lon, lat];
        } else {
          const { lat, lon } = await geocoderFn(proprietes);
          coordonnees = [lon, lat];
        }
      } catch (e) {
        erreurs.push(e.message);
      }
    }
    if (!erreurs.length) {
      const fiche = {
        id: idUnique(slugifier(`${proprietes.nom} ${proprietes.commune}`), ids),
        ...proprietes, date_ajout: aujourdhui, source: `import ${fichier}`,
      };
      const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: coordonnees }, properties: ordonner(fiche) };
      erreurs.push(...validerActeur(feature).map((e) => e.replace(/^[^:]+ : /, '')));
      if (!erreurs.length) {
        collection.features.push(feature);
        ids.add(fiche.id);
        deja.add(cle);
        ajoutes.push({ ligne: l._ligne, nom: fiche.nom, commune: fiche.commune, id: fiche.id, source: l.source_web });
      }
    }
    if (erreurs.length) refuses.push({ ligne: l._ligne, nom: l.nom || '(sans nom)', erreurs: [...new Set(erreurs)] });
    else if (avertissements.length) avertis.push({ ligne: l._ligne, nom: l.nom, avertissements });
  }
  return { collection, ajoutes, refuses, avertis };
}

const cellule = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

export function rapportImport({ ajoutes, refuses, avertis }, fichier) {
  const r = [`Import de \`${fichier}\` : **${ajoutes.length} acteur(s) ajouté(s)**, ${refuses.length} ligne(s) refusée(s).`, ''];
  if (ajoutes.length) {
    r.push('### Acteurs ajoutés', '', 'Vérifiez chaque fiche, en particulier les informations proposées par une IA, avant de fusionner.', '',
      '| Ligne | Nom | Commune | Source indiquée |', '| --- | --- | --- | --- |',
      ...ajoutes.map((a) => `| ${a.ligne} | ${cellule(a.nom)} | ${cellule(a.commune)} | ${a.source ? cellule(a.source) : '—'} |`), '');
  }
  if (avertis.length) {
    r.push('### Ajoutés avec des champs ignorés', '', ...avertis.map((a) => `- Ligne ${a.ligne}, ${cellule(a.nom)} : ${a.avertissements.join(' ; ')}`), '');
  }
  if (refuses.length) {
    r.push('### Lignes refusées', '', 'Corrigez-les dans le fichier, puis déposez-le à nouveau dans le dossier `import/`.', '',
      ...refuses.map((x) => `- Ligne ${x.ligne}, ${cellule(x.nom)} : ${x.erreurs.join(' ; ')}`), '');
  }
  return r.join('\n');
}

async function principal() {
  const fichier = process.argv[2];
  if (!fichier) { console.error('Usage : node scripts/importer-csv.mjs import/fichier.csv'); process.exit(2); }
  const i = process.argv.indexOf('--rapport');
  const cheminRapport = i > -1 ? process.argv[i + 1] : 'rapport-import.md';
  const lignes = lireCsv(decoder(readFileSync(fichier)));
  const manquantes = OBLIGATOIRES.filter((c) => lignes.length && !(c in lignes[0]));
  let resultat;
  if (!lignes.length || manquantes.length) {
    resultat = { ajoutes: [], avertis: [], refuses: [{ ligne: 1, nom: basename(fichier), erreurs: [lignes.length ? `colonnes manquantes : ${manquantes.join(', ')} (voir docs/modele-import.csv)` : 'fichier vide'] }] };
  } else {
    const collection = lireActeurs();
    resultat = await importer(lignes, collection, { fichier: basename(fichier) });
    if (resultat.ajoutes.length) ecrireActeurs(collection);
  }
  const rapport = rapportImport(resultat, basename(fichier));
  appendFileSync(cheminRapport, rapport + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ajoutes=${resultat.ajoutes.length}\n`);
  console.log(rapport);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
