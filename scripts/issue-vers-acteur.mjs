#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Transforme une issue « [Ajout] » ou « [Modification] » en changement de data/acteurs.geojson.
// Utilisé par .github/workflows/formulaire-vers-pr.yml.
//
// Variables d'environnement : ISSUE_TITRE, ISSUE_CORPS, ISSUE_NUMERO
// Sorties (GITHUB_OUTPUT) : statut=ok|erreur, action, nom, id
// Fichier message.md : texte du commentaire à publier sur l'issue.

import { writeFileSync, appendFileSync } from 'node:fs';
import {
  CHAMPS, CHAMPS_LISTE, ETIQUETTES, IDS_ETIQUETTES,
  lireActeurs, ecrireActeurs, validerActeur, slugifier, idUnique,
} from './lib/referentiel.mjs';
import { lireFormulaire } from './lib/formulaire.mjs';
import { geocoder, lireCoordonnees } from './lib/geocodage.mjs';

export const ACTION_MODIFIER = 'Modifier les informations';
export const ACTION_RETIRER = 'Retirer de la carte (structure fermée ou hors périmètre)';
export const EFFACER = '-';

export const CHAMPS_AJOUT = [
  ...CHAMPS,
  {
    cle: 'confirmation', libelle: 'Confirmation', type: 'checkboxes',
    options: ['Je ne saisis que des informations publiques sur la structure, aucune donnée personnelle.'],
  },
];

export const CHAMPS_MODIFICATION = [
  {
    cle: 'identifiant', libelle: "Identifiant de l'acteur", type: 'input', requis: true,
    aide: 'Affiché en bas de la fiche de l’acteur sur la carte (ex. : fablab-du-coin-merignac). Le lien « Proposer une modification » de la fiche le remplit automatiquement.',
  },
  { cle: 'action', libelle: 'Type de demande', type: 'dropdown', requis: true, options: [ACTION_MODIFIER, ACTION_RETIRER] },
  {
    cle: 'motif', libelle: 'Motif ou précisions', type: 'textarea',
    aide: 'Obligatoire pour un retrait. Pour une modification, ne remplissez ci-dessous que les champs qui changent ; écrivez « - » pour vider un champ facultatif.',
  },
  ...CHAMPS.map((c) => ({ ...c, requisAjout: false })),
];

export class ErreurFormulaire extends Error {
  constructor(erreurs) {
    super(erreurs.join('\n'));
    this.erreurs = erreurs;
  }
}

const libelleVersEtiquette = new Map(ETIQUETTES.map((e) => [e.libelle, e.id]));

/** Convertit les valeurs saisies en propriétés GeoJSON. */
function versProprietes(saisie) {
  const p = {};
  for (const [cle, valeur] of Object.entries(saisie)) {
    if (['coordonnees', 'confirmation', 'identifiant', 'action', 'motif'].includes(cle)) continue;
    if (valeur === EFFACER) { p[cle] = null; continue; }
    if (cle === 'etiquettes') {
      p.etiquettes = valeur.map((l) => libelleVersEtiquette.get(l) ?? l);
    } else if (cle === 'reseaux') {
      p.reseaux = valeur.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    } else if (cle === 'siret') {
      p.siret = valeur.replace(/\s/g, '');
    } else if (cle === 'rna') {
      p.rna = valeur.replace(/\s/g, '').toUpperCase();
    } else if (cle === 'site') {
      p.site = /^https?:\/\//i.test(valeur) ? valeur : `https://${valeur}`;
    } else if (cle === 'description') {
      p.description = valeur.replace(/\s+/g, ' ').trim();
    } else {
      p[cle] = valeur;
    }
  }
  return p;
}

/** Applique des propriétés sur une fiche existante (null = suppression). */
function fusionner(cible, nouvelles) {
  for (const [cle, valeur] of Object.entries(nouvelles)) {
    if (valeur === null || (CHAMPS_LISTE.has(cle) && Array.isArray(valeur) && valeur.length === 0)) delete cible[cle];
    else cible[cle] = valeur;
  }
  return cible;
}

/** Ordre stable des propriétés dans le fichier, pour des différences lisibles. */
const ORDRE = ['id', ...CHAMPS.map((c) => c.cle).filter((c) => c !== 'coordonnees'),
  'date_ajout', 'date_modification', 'derniere_verification', 'statut_verification', 'source'];
function ordonner(p) {
  const r = {};
  for (const cle of ORDRE) if (p[cle] !== undefined) r[cle] = p[cle];
  for (const cle of Object.keys(p)) if (!(cle in r)) r[cle] = p[cle];
  return r;
}

export function typeDeDemande(titre) {
  if (/^\s*\[Ajout\]/i.test(titre)) return 'ajout';
  if (/^\s*\[Modification\]/i.test(titre)) return 'modification';
  return null;
}

function trouverActeur(collection, identifiant) {
  const cible = identifiant.trim();
  const parId = collection.features.find((f) => f.properties.id === cible);
  if (parId) return parId;
  const norm = slugifier(cible);
  const parNom = collection.features.filter((f) => slugifier(f.properties.nom) === norm);
  if (parNom.length === 1) return parNom[0];
  if (parNom.length > 1) {
    throw new ErreurFormulaire([`Plusieurs acteurs s’appellent « ${cible} ». Indiquez l’identifiant exact : ${parNom.map((f) => f.properties.id).join(', ')}.`]);
  }
  throw new ErreurFormulaire([`Aucun acteur ne correspond à l’identifiant « ${cible} ».`]);
}

async function localiser(saisie, fiche, geocoderFn) {
  if (saisie.coordonnees && saisie.coordonnees !== EFFACER) {
    const { lat, lon } = lireCoordonnees(saisie.coordonnees);
    return [lon, lat];
  }
  const { lat, lon } = await geocoderFn({
    adresse: fiche.adresse, code_postal: fiche.code_postal, commune: fiche.commune,
  });
  return [lon, lat];
}

/**
 * Cœur du traitement, sans effet de bord : renvoie la collection modifiée
 * et un résumé, ou lève ErreurFormulaire.
 */
export async function traiterFormulaire({
  titre, corps, numero, collection, aujourdhui = new Date().toISOString().slice(0, 10),
  geocoderFn = geocoder,
}) {
  const type = typeDeDemande(titre);
  if (!type) throw new ErreurFormulaire(['Le titre doit commencer par [Ajout] ou [Modification].']);
  const source = numero ? `formulaire #${numero}` : 'formulaire';

  if (type === 'ajout') {
    const saisie = lireFormulaire(corps, CHAMPS_AJOUT);
    const erreurs = [];
    if (!saisie.confirmation?.length) erreurs.push('Cochez la case de confirmation (informations publiques uniquement).');
    const proprietes = versProprietes(saisie);
    for (const cle of Object.keys(proprietes)) if (proprietes[cle] === null) delete proprietes[cle];
    if (erreurs.length) throw new ErreurFormulaire(erreurs);

    const ids = new Set(collection.features.map((f) => f.properties.id));
    const doublon = collection.features.find((f) =>
      slugifier(f.properties.nom) === slugifier(proprietes.nom ?? '')
      && slugifier(f.properties.commune) === slugifier(proprietes.commune ?? ''));
    if (doublon) {
      throw new ErreurFormulaire([`« ${doublon.properties.nom} » (${doublon.properties.commune}) existe déjà sur la carte (identifiant : ${doublon.properties.id}). Utilisez le formulaire de modification.`]);
    }

    const fiche = {
      id: idUnique(slugifier(`${proprietes.nom ?? ''} ${proprietes.commune ?? ''}`), ids),
      ...proprietes,
      date_ajout: aujourdhui,
      source,
    };
    const prealables = validerSaisie(fiche);
    if (prealables.length) throw new ErreurFormulaire(prealables);

    let coordonnees;
    try {
      coordonnees = await localiser(saisie, fiche, geocoderFn);
    } catch (e) {
      throw new ErreurFormulaire([e.message]);
    }
    const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: coordonnees }, properties: ordonner(fiche) };
    const finales = validerActeur(feature);
    if (finales.length) throw new ErreurFormulaire(finales);
    collection.features.push(feature);
    return { collection, resume: { action: 'ajout', nom: fiche.nom, id: fiche.id } };
  }

  // Modification ou retrait
  const saisie = lireFormulaire(corps, CHAMPS_MODIFICATION);
  if (!saisie.identifiant) throw new ErreurFormulaire(["Indiquez l'identifiant de l'acteur."]);
  const feature = trouverActeur(collection, saisie.identifiant);
  const nom = feature.properties.nom;

  if (saisie.action === ACTION_RETIRER) {
    if (!saisie.motif) throw new ErreurFormulaire(['Précisez le motif du retrait.']);
    collection.features = collection.features.filter((f) => f !== feature);
    return { collection, resume: { action: 'retrait', nom, id: feature.properties.id, motif: saisie.motif } };
  }

  const nouvelles = versProprietes(saisie);
  for (const cle of CHAMPS.filter((c) => c.requisAjout).map((c) => c.cle)) {
    if (nouvelles[cle] === null) throw new ErreurFormulaire([`Le champ « ${CHAMPS.find((c) => c.cle === cle).libelle} » est obligatoire et ne peut pas être vidé.`]);
  }
  const adresseChangee = ['adresse', 'code_postal', 'commune'].some((c) => c in nouvelles);
  if (Object.keys(nouvelles).length === 0 && !saisie.coordonnees) {
    throw new ErreurFormulaire(['Aucun champ à modifier n’a été rempli.']);
  }
  const fiche = fusionner({ ...feature.properties }, nouvelles);
  fiche.date_modification = aujourdhui;
  const prealables = validerSaisie(fiche);
  if (prealables.length) throw new ErreurFormulaire(prealables);

  let coordonnees = feature.geometry.coordinates;
  if (saisie.coordonnees || adresseChangee) {
    try {
      coordonnees = await localiser(saisie, fiche, geocoderFn);
    } catch (e) {
      throw new ErreurFormulaire([e.message]);
    }
  }
  const modifiee = { type: 'Feature', geometry: { type: 'Point', coordinates: coordonnees }, properties: ordonner(fiche) };
  const finales = validerActeur(modifiee);
  if (finales.length) throw new ErreurFormulaire(finales);
  collection.features = collection.features.map((f) => (f === feature ? modifiee : f));
  return { collection, resume: { action: 'modification', nom: fiche.nom, id: fiche.id } };
}

/** Validation avant géocodage (on ne contrôle pas encore la géométrie). */
function validerSaisie(fiche) {
  const factice = { type: 'Feature', geometry: { type: 'Point', coordinates: [-0.58, 44.84] }, properties: fiche };
  const erreurs = validerActeur(factice).map((e) => e.replace(/^[^:]+ : /, ''));
  for (const e of fiche.etiquettes ?? []) if (!IDS_ETIQUETTES.has(e)) erreurs.push(`Étiquette inconnue : ${e}`);
  return [...new Set(erreurs)];
}

// --- Exécution en ligne de commande (GitHub Actions) ---
async function principal() {
  const titre = process.env.ISSUE_TITRE ?? '';
  const corps = process.env.ISSUE_CORPS ?? '';
  const numero = process.env.ISSUE_NUMERO ?? '';
  const sortie = (cle, val) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${cle}=${String(val).replace(/\n/g, ' ')}\n`);
  };

  try {
    const { collection, resume } = await traiterFormulaire({ titre, corps, numero, collection: lireActeurs() });
    ecrireActeurs(collection);
    const verbes = { ajout: 'Ajout', modification: 'Modification', retrait: 'Retrait' };
    sortie('statut', 'ok');
    sortie('action', verbes[resume.action]);
    sortie('nom', resume.nom);
    sortie('id', resume.id);
    writeFileSync('message.md', [
      `✅ Demande lue correctement : **${verbes[resume.action]} de « ${resume.nom} »** (identifiant \`${resume.id}\`).`,
      '',
      'Une proposition de modification a été ouverte : elle sera visible sur la carte dès qu’un membre de l’équipe l’aura validée (fusionnée).',
      resume.motif ? `\nMotif indiqué : ${resume.motif}` : '',
    ].join('\n'));
    console.log(`OK : ${resume.action} ${resume.id}`);
  } catch (e) {
    const erreurs = e instanceof ErreurFormulaire ? e.erreurs : [`Erreur inattendue : ${e.message}`];
    sortie('statut', 'erreur');
    writeFileSync('message.md', [
      '⚠️ La demande n’a pas pu être traitée :',
      '',
      ...erreurs.map((m) => `- ${m}`),
      '',
      'Corrigez l’issue (menu « … » → *Edit*) : elle sera relue automatiquement.',
    ].join('\n'));
    console.error(erreurs.join('\n'));
    if (!(e instanceof ErreurFormulaire)) process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
