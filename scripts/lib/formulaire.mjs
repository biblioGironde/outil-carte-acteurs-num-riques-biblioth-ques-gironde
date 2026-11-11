// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Lecture du corps d'une issue créée depuis un formulaire GitHub (Issue Forms).
// Le corps est du Markdown : « ### Libellé » suivi de la valeur saisie.

const VIDE = new Set(['_no response_', '_aucune réponse_', 'none', '']);

/** Découpe le corps en { libellé: valeur brute }. */
export function decouperSections(corps) {
  const sections = {};
  const lignes = String(corps ?? '').replace(/\r\n/g, '\n').split('\n');
  let titre = null;
  let tampon = [];
  const fermer = () => {
    if (titre !== null) sections[titre] = tampon.join('\n').trim();
  };
  for (const ligne of lignes) {
    const m = ligne.match(/^###\s+(.+?)\s*$/);
    if (m) {
      fermer();
      titre = m[1];
      tampon = [];
    } else if (titre !== null) {
      tampon.push(ligne);
    }
  }
  fermer();
  return sections;
}

export function estVide(valeur) {
  return VIDE.has(String(valeur ?? '').trim().toLowerCase());
}

/** Renvoie les libellés cochés d'une liste de cases. */
export function casesCochees(valeur) {
  return String(valeur ?? '')
    .split('\n')
    .map((l) => l.match(/^\s*-\s*\[[xX]\]\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

/**
 * Transforme le corps d'issue en objet { cle: valeur } à partir de la
 * définition des champs ({ cle, libelle, type }). Les champs vides sont omis.
 */
export function lireFormulaire(corps, champs) {
  const sections = decouperSections(corps);
  const resultat = {};
  for (const champ of champs) {
    if (!(champ.libelle in sections)) continue;
    const brut = sections[champ.libelle];
    if (champ.type === 'checkboxes') {
      const coches = casesCochees(brut);
      if (coches.length) resultat[champ.cle] = coches;
    } else if (!estVide(brut)) {
      resultat[champ.cle] = brut.trim();
    }
  }
  return resultat;
}
