// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Outils de test : reproduit le corps d'issue que GitHub produit à partir d'un formulaire.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from '../scripts/lib/referentiel.mjs';

/** Lecture minimale des formulaires générés (format maîtrisé par generer-formulaires.mjs). */
export function lireGabarit(nom) {
  const texte = readFileSync(join(RACINE, '.github', 'ISSUE_TEMPLATE', nom), 'utf8');
  const champs = [];
  let courant = null;
  for (const ligne of texte.split('\n')) {
    let m;
    if ((m = ligne.match(/^ {2}- type: (\w+)/))) {
      courant = { type: m[1], options: [] };
      champs.push(courant);
    } else if (courant && (m = ligne.match(/^ {4}id: (\S+)/))) courant.id = m[1];
    else if (courant && (m = ligne.match(/^ {6}label: (".*")$/))) courant.label = JSON.parse(m[1]);
    else if (courant && (m = ligne.match(/^ {8}- (?:label: )?(".*")$/))) courant.options.push(JSON.parse(m[1]));
  }
  return champs.filter((c) => c.type !== 'markdown');
}

/** Construit le corps d'issue tel que GitHub le génère. */
export function corpsIssue(nomGabarit, valeurs) {
  return lireGabarit(nomGabarit).map((c) => {
    let v;
    if (c.type === 'checkboxes') {
      const coches = valeurs[c.id] ?? [];
      v = c.options.map((o) => `- [${coches.includes(o) ? 'X' : ' '}] ${o}`).join('\n');
    } else {
      v = valeurs[c.id] ?? '_No response_';
    }
    return `### ${c.label}\n\n${v}`;
  }).join('\n\n');
}

export function collectionVide() {
  return { type: 'FeatureCollection', features: [] };
}

/** Faux service de géocodage. */
export const geocodageFactice = async ({ commune }) => {
  if (commune === 'Introuvable') throw new Error('Adresse introuvable');
  return { lat: 44.8378, lon: -0.5792 };
};

/** Fabrique un faux fetch à partir d'une fonction (url) => { status, json }. */
export function fauxFetch(regle) {
  return async (url, options = {}) => {
    const r = await regle(String(url), options);
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
    };
  };
}
