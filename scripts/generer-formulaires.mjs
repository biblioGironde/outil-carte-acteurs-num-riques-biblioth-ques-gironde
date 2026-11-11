#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Génère les formulaires GitHub (.github/ISSUE_TEMPLATE/*.yml) à partir du référentiel.
// À relancer après toute modification de data/etiquettes.json :
//   node scripts/generer-formulaires.mjs
// Avec --verifier, échoue si les fichiers ne sont pas à jour (utilisé en CI).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './lib/referentiel.mjs';
import { CHAMPS_AJOUT, CHAMPS_MODIFICATION } from './issue-vers-acteur.mjs';

const q = (s) => JSON.stringify(s); // chaîne YAML entre guillemets doubles

function champYaml(c, { requis }) {
  const l = [`  - type: ${c.type}`, `    id: ${c.cle}`, '    attributes:', `      label: ${q(c.libelle)}`];
  if (c.aide) l.push(`      description: ${q(c.aide)}`);
  if (c.exemple && c.type !== 'checkboxes' && c.type !== 'dropdown') l.push(`      placeholder: ${q(c.exemple)}`);
  if (c.type === 'dropdown') {
    l.push('      options:', ...c.options.map((o) => `        - ${q(o)}`));
  }
  if (c.type === 'checkboxes') {
    l.push('      options:', ...c.options.map((o) => `        - label: ${q(o)}${c.cle === 'confirmation' ? '\n          required: true' : ''}`));
  }
  if (c.type !== 'checkboxes') l.push('    validations:', `      required: ${requis(c) ? 'true' : 'false'}`);
  return l.join('\n');
}

function formulaire({ nom, description, titre, intro, champs, requis }) {
  return [
    '# Fichier généré par scripts/generer-formulaires.mjs — ne pas modifier à la main.',
    `name: ${q(nom)}`,
    `description: ${q(description)}`,
    `title: ${q(titre)}`,
    'body:',
    '  - type: markdown',
    '    attributes:',
    `      value: ${q(intro)}`,
    ...champs.map((c) => champYaml(c, { requis })),
    '',
  ].join('\n');
}

const fichiers = {
  'ajout-acteur.yml': formulaire({
    nom: 'Ajouter un acteur',
    description: 'Proposer une nouvelle structure sur la carte (réservé aux collaborateurs du dépôt).',
    titre: '[Ajout] ',
    intro: 'Complétez le titre après **[Ajout]** avec le nom de la structure. La demande est relue automatiquement, puis une proposition de modification est ouverte pour validation. Seules les demandes des collaborateurs du dépôt sont traitées.',
    champs: CHAMPS_AJOUT,
    requis: (c) => Boolean(c.requisAjout),
  }),
  'modification-acteur.yml': formulaire({
    nom: 'Modifier ou retirer un acteur',
    description: 'Corriger une fiche existante ou retirer une structure de la carte (réservé aux collaborateurs du dépôt).',
    titre: '[Modification] ',
    intro: 'Ne remplissez que les champs qui changent : les champs laissés vides restent inchangés. Pour les cases à cocher, cochez la liste complète souhaitée (elle remplace l’ancienne).',
    champs: CHAMPS_MODIFICATION,
    requis: (c) => Boolean(c.requis),
  }),
  'config.yml': 'blank_issues_enabled: true\n',
};

const verifier = process.argv.includes('--verifier');
let aJour = true;
for (const [nomFichier, contenu] of Object.entries(fichiers)) {
  const chemin = join(RACINE, '.github', 'ISSUE_TEMPLATE', nomFichier);
  const actuel = existsSync(chemin) ? readFileSync(chemin, 'utf8') : null;
  if (verifier) {
    if (actuel !== contenu) {
      aJour = false;
      console.error(`Formulaire obsolète : ${nomFichier}. Lancez « node scripts/generer-formulaires.mjs ».`);
    }
  } else if (actuel !== contenu) {
    writeFileSync(chemin, contenu);
    console.log(`Écrit : .github/ISSUE_TEMPLATE/${nomFichier}`);
  }
}
if (verifier && !aJour) process.exit(1);
