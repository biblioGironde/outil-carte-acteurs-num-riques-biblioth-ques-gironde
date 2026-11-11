// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Référentiel partagé : étiquettes, champs des formulaires, validation des données.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FICHIER_ACTEURS = join(RACINE, 'data', 'acteurs.geojson');
export const FICHIER_ETIQUETTES = join(RACINE, 'data', 'etiquettes.json');

export const REFERENTIEL = JSON.parse(readFileSync(FICHIER_ETIQUETTES, 'utf8'));
export const ETIQUETTES = REFERENTIEL.etiquettes;
export const IDS_ETIQUETTES = new Set(ETIQUETTES.map((e) => e.id));

// Emprise large de la Gironde (marge comprise) pour contrôler les coordonnées.
export const EMPRISE_GIRONDE = { latMin: 44.1, latMax: 45.7, lonMin: -1.35, lonMax: 0.4 };

/**
 * Champs communs aux formulaires. `cle` = identifiant du champ dans le
 * formulaire GitHub ET nom de la propriété dans le GeoJSON.
 */
export const CHAMPS = [
  { cle: 'nom', libelle: 'Nom de la structure', type: 'input', requisAjout: true },
  {
    cle: 'etiquettes', libelle: 'Étiquettes', type: 'checkboxes',
    aide: 'Cochez une ou plusieurs étiquettes.',
    options: ETIQUETTES.map((e) => e.libelle),
  },
  {
    cle: 'specialite_musique', libelle: 'Spécialité musicale (étiquette Musique uniquement)', type: 'dropdown',
    options: REFERENTIEL.specialites_musique,
  },
  {
    cle: 'description', libelle: 'Description courte', type: 'textarea', requisAjout: true,
    aide: '2 ou 3 phrases : ce que fait la structure, pour qui. 500 caractères maximum.',
  },
  { cle: 'adresse', libelle: 'Adresse (numéro et rue)', type: 'input', requisAjout: true },
  { cle: 'code_postal', libelle: 'Code postal', type: 'input', requisAjout: true, exemple: '33000' },
  { cle: 'commune', libelle: 'Commune', type: 'input', requisAjout: true },
  {
    cle: 'coordonnees', libelle: 'Coordonnées GPS (facultatif)', type: 'input',
    aide: 'Format « latitude, longitude » (ex. 44.8378, -0.5792). Laissez vide : l’adresse sera géolocalisée automatiquement.',
  },
  { cle: 'site', libelle: 'Site web', type: 'input', exemple: 'https://' },
  {
    cle: 'email', libelle: 'Courriel de contact de la structure', type: 'input',
    aide: 'Adresse générique uniquement (contact@…, accueil@…), jamais une adresse nominative.',
  },
  { cle: 'telephone', libelle: 'Téléphone de la structure', type: 'input' },
  {
    cle: 'reseaux', libelle: "Réseau(x) d'appartenance", type: 'input',
    aide: 'Séparés par des virgules (ex. : Hubikoop, Promeneurs du Net Gironde).',
  },
  { cle: 'public', libelle: 'Publics', type: 'checkboxes', options: REFERENTIEL.publics },
  {
    cle: 'siret', libelle: 'SIRET', type: 'input',
    aide: '14 chiffres. Fortement conseillé : il sert à la vérification annuelle automatique.',
  },
  { cle: 'rna', libelle: 'Numéro RNA', type: 'input', aide: 'W suivi de 9 chiffres (ex. W332012345).' },
];

export const CHAMPS_LISTE = new Set(['etiquettes', 'public', 'reseaux']);

export function slugifier(texte) {
  return String(texte)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function idUnique(base, idsExistants) {
  let id = base || 'acteur';
  let n = 2;
  while (idsExistants.has(id)) id = `${base}-${n++}`;
  return id;
}

export function lireActeurs(fichier = FICHIER_ACTEURS) {
  return JSON.parse(readFileSync(fichier, 'utf8'));
}

export function ecrireActeurs(collection, fichier = FICHIER_ACTEURS) {
  collection.features.sort((a, b) =>
    a.properties.nom.localeCompare(b.properties.nom, 'fr', { sensitivity: 'base' }));
  writeFileSync(fichier, JSON.stringify(collection, null, 2) + '\n');
}

export function dansGironde(lat, lon) {
  const e = EMPRISE_GIRONDE;
  return lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax;
}

const RE_URL = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const RE_EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Valide un acteur (Feature GeoJSON). Renvoie une liste d'erreurs lisibles. */
export function validerActeur(f) {
  const erreurs = [];
  const p = f?.properties ?? {};
  const nom = p.nom || p.id || '(sans nom)';
  const err = (m) => erreurs.push(`${nom} : ${m}`);

  if (f?.type !== 'Feature') err('objet GeoJSON invalide (type Feature attendu)');
  if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) err('identifiant manquant ou invalide');
  for (const c of CHAMPS.filter((c) => c.requisAjout)) {
    if (!p[c.cle] || !String(p[c.cle]).trim()) err(`champ obligatoire manquant : ${c.libelle}`);
  }
  if (!Array.isArray(p.etiquettes) || p.etiquettes.length === 0) err('au moins une étiquette est requise');
  else for (const e of p.etiquettes) if (!IDS_ETIQUETTES.has(e)) err(`étiquette inconnue : ${e}`);
  if (p.specialite_musique && !REFERENTIEL.specialites_musique.includes(p.specialite_musique)) {
    err(`spécialité musicale inconnue : ${p.specialite_musique}`);
  }
  if (p.specialite_musique && !p.etiquettes?.includes('musique')) {
    err('une spécialité musicale est renseignée sans l’étiquette Musique');
  }
  if (p.description && p.description.length > 500) err('description trop longue (500 caractères maximum)');
  if (p.code_postal && !/^33\d{3}$/.test(p.code_postal)) err(`code postal hors Gironde : ${p.code_postal}`);
  if (p.site && !RE_URL.test(p.site)) err(`adresse de site invalide : ${p.site}`);
  if (p.email && !RE_EMAIL.test(p.email)) err(`courriel invalide : ${p.email}`);
  if (p.siret && !/^\d{14}$/.test(p.siret)) err(`SIRET invalide (14 chiffres attendus) : ${p.siret}`);
  if (p.rna && !/^W\d{9}$/.test(p.rna)) err(`numéro RNA invalide : ${p.rna}`);
  for (const c of ['public', 'reseaux']) {
    if (p[c] !== undefined && !Array.isArray(p[c])) err(`le champ ${c} doit être une liste`);
  }
  for (const pub of p.public ?? []) {
    if (!REFERENTIEL.publics.includes(pub)) err(`public inconnu : ${pub}`);
  }

  const coords = f?.geometry?.coordinates;
  if (f?.geometry?.type !== 'Point' || !Array.isArray(coords) || coords.length !== 2) {
    err('géométrie manquante (point attendu)');
  } else if (!dansGironde(coords[1], coords[0])) {
    err(`coordonnées hors Gironde : ${coords[1]}, ${coords[0]}`);
  }
  return erreurs;
}

export function validerCollection(collection) {
  const erreurs = [];
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    return ['Le fichier doit être une FeatureCollection GeoJSON.'];
  }
  const vus = new Set();
  for (const f of collection.features) {
    erreurs.push(...validerActeur(f));
    const id = f?.properties?.id;
    if (id && vus.has(id)) erreurs.push(`Identifiant en double : ${id}`);
    vus.add(id);
  }
  return erreurs;
}
