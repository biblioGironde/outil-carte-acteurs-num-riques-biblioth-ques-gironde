// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
// Géocodage via le service de la Géoplateforme (IGN), successeur de l'API Adresse.
import { dansGironde } from './referentiel.mjs';

const URL_GEOCODAGE = 'https://data.geopf.fr/geocodage/search';
const SCORE_MINIMUM = 0.5;

/**
 * Renvoie { lat, lon, libelle, score } ou lève une erreur explicite.
 */
export async function geocoder({ adresse, code_postal, commune }, fetchFn = fetch) {
  const q = [adresse, code_postal, commune].filter(Boolean).join(' ');
  const url = new URL(URL_GEOCODAGE);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '1');
  url.searchParams.set('index', 'address');
  if (code_postal) url.searchParams.set('postcode', code_postal);

  let reponse;
  try {
    reponse = await fetchFn(url, { signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new Error(`Le service de géolocalisation ne répond pas (${e.message}). Réessayez plus tard ou indiquez les coordonnées GPS.`);
  }
  if (!reponse.ok) {
    throw new Error(`Le service de géolocalisation a renvoyé une erreur ${reponse.status}. Indiquez les coordonnées GPS dans le formulaire.`);
  }
  const donnees = await reponse.json();
  const resultat = donnees?.features?.[0];
  if (!resultat) {
    throw new Error(`Adresse introuvable : « ${q} ». Vérifiez-la ou indiquez les coordonnées GPS.`);
  }
  const [lon, lat] = resultat.geometry.coordinates;
  const { score = 0, label = '' } = resultat.properties ?? {};
  if (score < SCORE_MINIMUM) {
    throw new Error(`Adresse trop imprécise : « ${q} » (meilleure correspondance : « ${label} »). Précisez-la ou indiquez les coordonnées GPS.`);
  }
  if (!dansGironde(lat, lon)) {
    throw new Error(`L’adresse « ${q} » a été localisée hors de Gironde (« ${label} »).`);
  }
  return { lat: arrondir(lat), lon: arrondir(lon), libelle: label, score };
}

/** Lit « lat, lon » saisi à la main. */
export function lireCoordonnees(texte) {
  const m = String(texte).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) throw new Error(`Coordonnées illisibles : « ${texte} ». Format attendu : 44.8378, -0.5792`);
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (!dansGironde(lat, lon)) {
    throw new Error(`Les coordonnées ${lat}, ${lon} ne sont pas en Gironde (latitude puis longitude ?).`);
  }
  return { lat: arrondir(lat), lon: arrondir(lon) };
}

function arrondir(x) {
  return Math.round(x * 1e6) / 1e6;
}
