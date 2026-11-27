// SPDX-License-Identifier: AGPL-3.0-or-later
// © Département de la Gironde — biblio.gironde
(() => {
  'use strict';

  const EMPRISE = [[44.19, -1.27], [45.58, 0.32]]; // Gironde
  const depot = document.querySelector('meta[name="depot"]')?.content || '';
  const urlDepot = `https://github.com/${depot}`;
  const urlFormulaire = (gabarit, params = {}) => {
    const u = new URL(`${urlDepot}/issues/new`);
    u.searchParams.set('template', gabarit);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };

  const el = (id) => document.getElementById(id);
  const panneau = el('panneau');
  const poignee = el('poignee');
  const liste = el('liste');
  const champ = el('champ-recherche');
  const zoneFiltres = el('filtres');
  const toutAfficher = el('tout-afficher');
  const compteur = el('compteur');
  const sousFiltres = el('filtres-musique');
  const choixDomaine = el('choix-domaine');
  const choixActivite = el('choix-activite');
  const sousFiltresBib = el('filtres-bibliotheque');
  const choixService = el('choix-service');

  el('lien-ajout').href = urlFormulaire('ajout-acteur.yml');
  el('lien-depot').href = urlDepot;

  // ---------- Utilitaires ----------
  const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normaliser = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const urlSure = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const dateFr = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const estMobile = () => window.matchMedia('(max-width: 760px)').matches;

  // ---------- Carte ----------
  const carte = L.map('carte', {
    zoomControl: true,
    maxBounds: L.latLngBounds(EMPRISE).pad(0.6),
    minZoom: 8,
  }).fitBounds(EMPRISE, { padding: [20, 20] });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
  }).addTo(carte);

  const calque = L.layerGroup().addTo(carte);

  // ---------- Calque des communes ----------
  // Contours sous les marqueurs (volet dédié) : ils ne gênent pas le clic sur les acteurs.
  carte.createPane('communes').style.zIndex = 350;
  const STYLE_COMMUNE = { pane: 'communes', color: '#0f5e6b', weight: 0.8, opacity: 0.55, fillColor: '#0f5e6b', fillOpacity: 0.01 };
  const STYLE_COMMUNE_OCCUPEE = { fillOpacity: 0.07 };
  const STYLE_COMMUNE_SURVOL = { weight: 2.2, opacity: 0.9, fillOpacity: 0.14 };
  let communes = null;          // L.GeoJSON, chargé à la première demande
  let communesVisibles = false;
  let teinte = '';              // indicateur INSEE affiché en remplissage (clé de INDICATEURS), '' = aucun

  // ---------- Indicateurs INSEE par commune ----------
  // Chaque indicateur : classes (seuils) et rampe séquentielle d'une seule teinte, du clair au foncé.
  // Une seule couleur par thème : bleu population, orange territoire, violet revenus, rouge fragilités sociales,
  // vert âge, ardoise isolement et mobilité. Les indicateurs s'excluent : un seul remplissage à la fois.
  const RAMPES = {
    bleu: ['#cce3fd', '#84b9f3', '#338ced', '#2370cd', '#1757ac', '#0e3d7e'],
    orange: ['#fde3d0', '#fbbf94', '#f8975a', '#e9702f', '#c2531a', '#8a3a12'],
    violet: ['#e7e1fb', '#c4b7f4', '#9d89ec', '#7a5fe0', '#5a3fc0', '#3b2785'],
    rouge: ['#fde2e1', '#f9b4b2', '#f28482', '#e05353', '#b83232', '#7f1d1d'],
    vert: ['#dcf3dd', '#addfae', '#78c47b', '#43a047', '#2e7d32', '#1b4d20'],
    ardoise: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#1e293b'],
  };
  const decimal = (n, d = 1) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d });
  const nombre = (n) => Math.round(n).toLocaleString('fr-FR');
  const habitants = (n) => `${nombre(n)} habitant${n > 1 ? 's' : ''}`;
  const pourcent = (n) => `${decimal(n)} %`;
  /** Libellés de légende : « moins de a », « a à b », « b et plus ». */
  const libellesClasses = (seuils, u = '') => seuils.map((s, i) => (i === 0 ? `moins de ${decimal(s)}${u}` : `${decimal(seuils[i - 1])} à ${decimal(s)}${u}`))
    .concat(`${decimal(seuils.at(-1))}${u} et plus`);
  const RP = 'INSEE, recensement 2023';
  const PETITS = 'Gris : effectif trop faible pour être significatif.';
  const DENS7 = ['Grands centres urbains', 'Centres urbains intermédiaires', 'Ceintures urbaines', 'Petites villes',
    'Bourgs ruraux', 'Rural à habitat dispersé', 'Rural à habitat très dispersé'];
  const EQUIPEMENTS = ['Ni bibliothèque ni France services', 'France services seulement', 'Bibliothèque seulement', 'Bibliothèque et France services'];
  const pct = (cle) => (p) => p[cle] ?? null;
  const INDICATEURS = {
    population: {
      groupe: 'Population et territoire', menu: 'Population', titre: 'Population municipale (INSEE)', rampe: 'bleu',
      seuils: [1000, 2000, 5000, 10000, 50000], valeur: (p) => p.population ?? null,
      libelles: ['moins de 1 000', '1 000 à 1 999', '2 000 à 4 999', '5 000 à 9 999', '10 000 à 49 999', '50 000 et plus'],
      texte: (v) => habitants(v),
    },
    densite: {
      groupe: 'Population et territoire', menu: 'Densité', titre: 'Densité (habitants par km²)', rampe: 'orange',
      seuils: [25, 50, 100, 250, 1000], valeur: (p) => (p.population != null && p.surface_km2 ? p.population / p.surface_km2 : null),
      texte: (v) => `${nombre(v)} hab./km²`,
    },
    typologie: {
      groupe: 'Population et territoire', menu: 'Type de commune (urbain / rural)', titre: 'Grille communale de densité (INSEE 2025)',
      couleurs: ['#8a3a12', '#b34a17', '#d9622a', '#f08442', '#f8a66f', '#fbc79f', '#fde3d0'], libelles: DENS7,
      categorie: (p) => (p.densite7 ? p.densite7 - 1 : null), texte: (v) => DENS7[v],
    },
    niveau: {
      groupe: 'Revenus et emploi', menu: 'Niveau de vie médian', titre: 'Niveau de vie médian (€ par an, INSEE 2023)', rampe: 'violet',
      seuils: [22000, 24000, 26000, 28000, 30000], valeur: pct('niveau_vie_median'),
      libelles: ['moins de 22 000 €', '22 000 à 23 999 €', '24 000 à 25 999 €', '26 000 à 27 999 €', '28 000 à 29 999 €', '30 000 € et plus'],
      texte: (v, p) => `Niveau de vie médian : ${nombre(v)} €/an${p.taux_pauvrete != null ? ` · pauvreté ${pourcent(p.taux_pauvrete)}` : ''}`,
      note: 'Gironde : 26 820 €. Gris : non diffusé (secret statistique).',
    },
    ouvriers: {
      groupe: 'Revenus et emploi', menu: 'Ouvriers et employés', titre: 'Part des ouvriers et employés parmi les actifs (%)', rampe: 'rouge',
      seuils: [40, 45, 50, 55, 60], valeur: pct('part_ouvriers_employes'), unite: ' %',
      texte: (v, p) => `Ouvriers et employés : ${pourcent(v)} des actifs${p.part_cadres != null ? ` · cadres : ${pourcent(p.part_cadres)}` : ''}`,
      note: `Gironde : 43,3 % (cadres : 21,9 %). ${RP}. ${PETITS}`,
    },
    chomage: {
      groupe: 'Revenus et emploi', menu: 'Taux de chômage', titre: 'Taux de chômage des 15-64 ans (%)', rampe: 'rouge',
      seuils: [6, 8, 10, 12, 14], valeur: pct('taux_chomage'), unite: ' %',
      texte: (v) => `Taux de chômage : ${pourcent(v)}`,
      note: `Gironde : 10,5 %. Au sens du recensement (déclaratif), ${RP}. ${PETITS}`,
    },
    diplomes: {
      groupe: 'Formation et jeunesse', menu: 'Peu ou pas diplômés', titre: 'Sans diplôme ou brevet des collèges seulement (%)', rampe: 'rouge',
      seuils: [16, 20, 24, 28, 32], valeur: pct('part_peu_diplomes'), unite: ' %',
      texte: (v) => `Peu ou pas diplômés : ${pourcent(v)} des 15 ans et plus sortis de l’école`,
      note: `Parmi les 15 ans et plus non scolarisés. Gironde : 20,5 %. ${RP}.`,
    },
    jeunes: {
      groupe: 'Formation et jeunesse', menu: 'Jeunes ni en emploi ni en études', titre: 'Jeunes de 15-24 ans ni en emploi ni en études (%)', rampe: 'rouge',
      seuils: [8, 12, 16, 20, 25], valeur: pct('part_jeunes_non_inseres'), unite: ' %',
      texte: (v) => `15-24 ans ni en emploi ni en études : ${pourcent(v)}`,
      note: `Gironde : 14 %. ${RP}. ${PETITS}`,
    },
    age: {
      groupe: 'Âge et familles', menu: 'Âge moyen', titre: 'Âge moyen (recensement 2022)', rampe: 'vert',
      seuils: [40, 42, 44, 46, 48], valeur: pct('age_moyen'),
      libelles: ['moins de 40 ans', '40 à 41,9 ans', '42 à 43,9 ans', '44 à 45,9 ans', '46 à 47,9 ans', '48 ans et plus'],
      texte: (v, p) => `Âge moyen : ${decimal(v)} ans · moins de 30 ans : ${pourcent(p.part_moins_30)} · 60 ans et plus : ${pourcent(p.part_60_plus)}`,
      note: 'Gironde : 41,8 ans. Du plus clair (communes jeunes) au plus foncé (communes âgées).',
    },
    seniors: {
      groupe: 'Âge et familles', menu: '80 ans et plus vivant seuls', titre: 'Part des 80 ans et plus vivant seuls (%)', rampe: 'ardoise',
      seuils: [30, 35, 40, 45, 50], valeur: pct('part_80_seuls'), unite: ' %',
      texte: (v) => `80 ans et plus vivant seuls : ${pourcent(v)}`,
      note: `Gironde : 42,2 %. Le recensement ne publie pas les 75 ans et plus vivant seuls par commune. ${RP}. ${PETITS}`,
    },
    monoparentales: {
      groupe: 'Âge et familles', menu: 'Familles monoparentales', titre: 'Part des familles monoparentales (%)', rampe: 'rouge',
      seuils: [6, 9, 12, 15, 18], valeur: pct('part_familles_monoparentales'), unite: ' %',
      texte: (v) => `Familles monoparentales : ${pourcent(v)} des familles`,
      note: `Gironde : 16,7 %. ${RP}. ${PETITS}`,
    },
    voiture: {
      groupe: 'Accès et services', menu: 'Ménages sans voiture', titre: 'Part des ménages sans voiture (%)', rampe: 'ardoise',
      seuils: [3, 4, 5, 7, 10], valeur: pct('part_menages_sans_voiture'), unite: ' %',
      texte: (v) => `Ménages sans voiture : ${pourcent(v)}`,
      note: `Gironde : 15,8 % (37,6 % à Bordeaux). ${RP}.`,
    },
    equipements: {
      groupe: 'Accès et services', menu: 'Bibliothèques et France services', titre: 'Bibliothèques et France services (INSEE BPE 2025)',
      couleurs: ['#f47230', '#00a888', '#84b9f3', '#1757ac'], libelles: EQUIPEMENTS,
      categorie: (p) => (p.nb_bibliotheques > 0 ? 2 : 0) + (p.nb_france_services > 0 ? 1 : 0),
      texte: (v, p) => `Bibliothèques : ${p.nb_bibliotheques ?? 0} · France services : ${p.nb_france_services ?? 0}`,
      note: 'Base permanente des équipements : bibliothèques et médiathèques publiques, espaces France services.',
    },
  };
  for (const t of Object.values(INDICATEURS)) {
    t.couleurs ??= RAMPES[t.rampe];
    t.libelles ??= libellesClasses(t.seuils, t.unite || '');
  }
  const COULEUR_NON_DIFFUSE = '#d4d4d4';
  /** Indice de classe (ou de catégorie) d'une commune pour l'indicateur t ; null si pas de donnée. */
  function classe(t, p) {
    if (t.categorie) return t.categorie(p);
    const v = t.valeur(p);
    return v == null ? null : t.seuils.filter((s) => v >= s).length;
  }
  function styleCommune(couche) {
    const t = INDICATEURS[teinte];
    const c = t ? classe(t, couche.feature.properties) : null;
    return {
      ...STYLE_COMMUNE,
      ...(couche.nb ? STYLE_COMMUNE_OCCUPEE : {}),
      ...(t ? { fillColor: c != null ? t.couleurs[c] : COULEUR_NON_DIFFUSE, fillOpacity: c != null ? 0.72 : 0.5, color: '#ffffff', weight: 0.6, opacity: 0.8 } : {}),
    };
  }
  function texteIndicateur(p) {
    const t = INDICATEURS[teinte];
    if (!t || teinte === 'population') return '';
    const v = t.categorie ? t.categorie(p) : t.valeur(p);
    return v == null ? 'Donnée non disponible<br>' : `${t.texte(v, p)}<br>`;
  }
  let chargementCommunes = null;

  /** Point dans un polygone (règle pair-impair) ; anneaux GeoJSON [lon, lat]. */
  function dansAnneau([x, y], anneau) {
    let dedans = false;
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const [xi, yi] = anneau[i];
      const [xj, yj] = anneau[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
    }
    return dedans;
  }
  function dansGeometrie(pt, g) {
    const polygones = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polygones.some(([ext, ...trous]) => dansAnneau(pt, ext) && !trous.some((t) => dansAnneau(pt, t)));
  }

  /** Nombre d'acteurs affichés par commune (contours), mis à jour à chaque filtre. */
  function compterParCommune(visibles) {
    if (!communes) return;
    communes.eachLayer((couche) => {
      const g = couche.feature.geometry;
      const b = couche.getBounds();
      couche.nb = visibles.filter((a) => {
        const ll = a.marqueur.getLatLng();
        return b.contains(ll) && dansGeometrie([ll.lng, ll.lat], g);
      }).length;
      couche.setStyle(styleCommune(couche));
    });
  }

  function chargerCommunes() {
    chargementCommunes ??= fetch('data/communes-gironde.geojson').then((r) => r.json()).then((geo) => {
      communes = L.geoJSON(geo, {
        style: () => STYLE_COMMUNE,
        onEachFeature: (f, couche) => {
          couche.bindTooltip(() => `<strong>${echapper(f.properties.nom)}</strong><br>${f.properties.population != null ? `${habitants(f.properties.population)}<br>` : ''}${texteIndicateur(f.properties)}${couche.nb
            ? `${couche.nb} acteur${couche.nb > 1 ? 's' : ''} affiché${couche.nb > 1 ? 's' : ''}` : 'Aucun acteur affiché'}`,
          { sticky: true, direction: 'top', className: 'infobulle-commune' });
          couche.on('mouseover', () => couche.setStyle(teinte ? { weight: 2.2, color: '#0f5e6b', opacity: 0.9 } : STYLE_COMMUNE_SURVOL));
          couche.on('mouseout', () => couche.setStyle(styleCommune(couche)));
          couche.on('click', () => carte.fitBounds(couche.getBounds(), { padding: [30, 30], maxZoom: 14 }));
        },
      });
      compterParCommune(acteurs.filter(correspond));
      return communes;
    });
    return chargementCommunes;
  }

  /** Le fond des communes est affiché dès que le contour ou un indicateur INSEE est actif. */
  async function majCalqueCommunes() {
    boutonCommunes?.setAttribute('aria-pressed', String(communesVisibles));
    if (choixIndicateur) choixIndicateur.value = teinte;
    choixIndicateur?.classList.toggle('actif', Boolean(teinte));
    dessinerLegende();
    if (communesVisibles || teinte) {
      const c = await chargerCommunes();
      c.eachLayer((couche) => couche.setStyle(styleCommune(couche)));
      c.addTo(carte);
    } else communes?.remove();
    ecrireUrl();
  }
  function afficherCommunes(oui) { communesVisibles = oui; return majCalqueCommunes(); }

  const legendePopulation = document.createElement('div');
  legendePopulation.className = 'legende-population';
  legendePopulation.hidden = true;
  function dessinerLegende() {
    const t = INDICATEURS[teinte];
    legendePopulation.hidden = !t;
    if (!t) return;
    // Données absentes : seulement si au moins une commune est concernée.
    const manque = communes ? communes.getLayers().some((c) => classe(t, c.feature.properties) == null) : Boolean(t.note?.includes('Gris'));
    legendePopulation.innerHTML = `<p class="legende-titre">${t.titre}</p><ul>${t.couleurs.map((c, i) => `<li><span class="legende-carre" style="background:${c}"></span>${t.libelles[i]}</li>`).join('')}${
      manque ? `<li><span class="legende-carre" style="background:${COULEUR_NON_DIFFUSE}"></span>non disponible</li>` : ''}</ul>${t.note ? `<p class="legende-note">${t.note}</p>` : ''}`;
  }

  let boutonCommunes;
  let choixIndicateur;
  const ControleCommunes = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar controle-calques');
      boutonCommunes = L.DomUtil.create('button', 'bouton-calque', div);
      boutonCommunes.type = 'button';
      boutonCommunes.setAttribute('aria-pressed', 'false');
      boutonCommunes.title = 'Afficher ou masquer les limites des communes';
      boutonCommunes.innerHTML = '<span class="icone-calque" aria-hidden="true"></span>Communes';
      const etiquette = L.DomUtil.create('label', 'choix-indicateur', div);
      etiquette.innerHTML = '<span class="visuellement-cache">Données INSEE par commune</span>';
      choixIndicateur = L.DomUtil.create('select', 'bouton-calque', etiquette);
      choixIndicateur.title = 'Teinter les communes selon un indicateur INSEE';
      const groupes = new Map();
      for (const [cle, t] of Object.entries(INDICATEURS)) {
        if (!groupes.has(t.groupe)) groupes.set(t.groupe, []);
        groupes.get(t.groupe).push(`<option value="${cle}">${echapper(t.menu)}</option>`);
      }
      choixIndicateur.innerHTML = '<option value="">Données INSEE…</option>'
        + [...groupes].map(([g, o]) => `<optgroup label="${echapper(g)}">${o.join('')}</optgroup>`).join('');
      div.append(legendePopulation);
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      const echec = (e) => { console.error(e); communesVisibles = false; teinte = ''; majCalqueCommunes(); };
      L.DomEvent.on(boutonCommunes, 'click', () => afficherCommunes(!communesVisibles).catch(echec));
      L.DomEvent.on(choixIndicateur, 'change', () => { teinte = choixIndicateur.value; majCalqueCommunes().catch(echec); });
      return div;
    },
  });
  new ControleCommunes().addTo(carte);

  // ---------- État ----------
  let etiquettes = [];
  let parId = new Map();
  let acteurs = [];
  const choisies = new Set();
  let recherche = '';
  let activites = [];          // référentiel des activités musicales
  let domaine = '';            // filtre Musique et MAO (étiquette musique) : domaine (libellé)
  let activite = '';           // filtre Musique et MAO (étiquette musique) : activité (identifiant)
  const libelleActivite = (id) => activites.find((x) => x.id === id)?.libelle;
  const idActivite = (libelle) => activites.find((x) => x.libelle === libelle)?.id;
  let services = [];           // référentiel des services d'inclusion numérique en bibliothèque
  let service = '';            // filtre Bibliothèque numérique : service (identifiant)
  const libelleService = (id) => services.find((x) => x.id === id)?.libelle;
  let actif = null;

  function lireUrl() {
    const p = new URLSearchParams(location.search);
    (p.get('etiquettes') || '').split(',').filter(Boolean).forEach((e) => choisies.add(e));
    recherche = p.get('q') || '';
    champ.value = recherche;
    domaine = p.get('domaine') || '';
    activite = p.get('activite') || '';
    service = p.get('service') || '';
    communesVisibles = p.get('communes') === '1';
    // ?insee=<indicateur> ; anciens liens ?population=1, ?densite=1, ?niveau=1, ?age=1 encore reconnus.
    teinte = p.get('insee') || ['age', 'niveau', 'densite', 'population'].find((t) => p.get(t) === '1') || '';
    if (!INDICATEURS[teinte]) teinte = '';
  }
  function ecrireUrl() {
    const p = new URLSearchParams();
    if (choisies.size) p.set('etiquettes', [...choisies].join(','));
    if (recherche) p.set('q', recherche);
    if (choisies.has('musique') && domaine) p.set('domaine', domaine);
    if (choisies.has('musique') && activite) p.set('activite', activite);
    if (choisies.has('bibliotheque') && service) p.set('service', service);
    if (communesVisibles) p.set('communes', '1');
    if (teinte) p.set('insee', teinte);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
  }

  function fondMarque(ids) {
    const couleurs = ids.map((id) => parId.get(id)?.couleur).filter(Boolean);
    if (couleurs.length <= 1) return couleurs[0] || '#475569';
    const pas = 360 / couleurs.length;
    return `conic-gradient(${couleurs.map((c, i) => `${c} ${i * pas}deg ${(i + 1) * pas}deg`).join(', ')})`;
  }

  function htmlMarque(ids) {
    return `<span class="marque" style="--fond-marque:${echapper(fondMarque(ids))}" aria-hidden="true"></span>`;
  }

  function htmlFiche(a) {
    const p = a.properties;
    const tags = (p.etiquettes || []).map((id) => {
      const e = parId.get(id);
      return e ? `<span class="etiquette" style="--couleur:${e.couleur}">${echapper(e.court)}</span>` : '';
    }).join('');
    const site = urlSure(p.site);
    const contacts = [
      site && `<a href="${echapper(site)}" target="_blank" rel="noopener">Site web</a>`,
      p.email && `<a href="mailto:${echapper(p.email)}">Courriel</a>`,
      p.telephone && `<a href="tel:${echapper(p.telephone.replace(/[^\d+]/g, ''))}">${echapper(p.telephone)}</a>`,
    ].filter(Boolean).join('');
    const lignes = [
      ['Adresse', `${echapper(p.adresse)}<br>${echapper(p.code_postal)} ${echapper(p.commune)}`],
      p.domaine_musique && ['Domaine', echapper(p.domaine_musique)],
      p.reseaux?.length && ['Réseaux', echapper(p.reseaux.join(', '))],
      p.public?.length && ['Publics', echapper(p.public.join(', '))],
    ].filter(Boolean).map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('');
    const verif = p.derniere_verification ? `Vérifié le ${dateFr(p.derniere_verification)}` : (p.date_modification || p.date_ajout ? `Mis à jour le ${dateFr(p.date_modification || p.date_ajout)}` : '');
    const lienModif = urlFormulaire('modification-acteur.yml', { title: `[Modification] ${p.nom}`, identifiant: p.id });
    return `<article class="fiche">
      <h2>${echapper(p.nom)}</h2>
      <div class="etiquettes">${tags}</div>
      ${p.activites_musique?.length ? `<div class="activites">${p.activites_musique.map((l) => `<span>${echapper(activites.find((x) => x.libelle === l)?.court || l)}</span>`).join('')}</div>` : ''}
      ${p.services_bibliotheque?.length ? `<div class="activites services">${p.services_bibliotheque.map((l) => `<span>${echapper(services.find((x) => x.libelle === l)?.court || l)}</span>`).join('')}</div>` : ''}
      ${p.description ? `<p>${echapper(p.description)}</p>` : ''}
      <dl>${lignes}</dl>
      ${contacts ? `<div class="contacts">${contacts}</div>` : ''}
      <p class="technique">${verif ? `${echapper(verif)} · ` : ''}<code>${echapper(p.id)}</code><br>
        <a href="${echapper(lienModif)}" target="_blank" rel="noopener">Proposer une modification</a></p>
    </article>`;
  }

  const filtreMusiqueActif = () => choisies.has('musique') && (domaine || activite);
  const correspondMusique = (p) => (!domaine || p.domaine_musique === domaine)
    && (!activite || (p.activites_musique || []).includes(libelleActivite(activite)));

  const correspondSousFiltre = (e, p) => {
    if (e === 'musique') return !filtreMusiqueActif() || correspondMusique(p);
    if (e === 'bibliotheque') return !service || (p.services_bibliotheque || []).includes(libelleService(service));
    return true;
  };

  function correspond(a) {
    const p = a.properties;
    const tags = p.etiquettes || [];
    // Les menus déroulants (Musique et MAO, Bibliothèque numérique) ne s'appliquent qu'aux acteurs
    // retenus au titre de l'étiquette correspondante : un acteur reste visible s'il est retenu par une autre étiquette.
    if (choisies.size && !tags.some((e) => choisies.has(e) && correspondSousFiltre(e, p))) return false;
    if (!recherche) return true;
    const texte = normaliser([p.nom, p.commune, p.code_postal, p.description, ...(p.reseaux || []),
      p.domaine_musique, ...(p.activites_musique || []), ...(p.services_bibliotheque || [])].join(' '));
    return normaliser(recherche).split(/\s+/).every((mot) => texte.includes(mot));
  }

  function dessinerFiltres() {
    zoneFiltres.innerHTML = '';
    for (const e of etiquettes) {
      const nb = acteurs.filter((a) => a.properties.etiquettes?.includes(e.id)).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'puce';
      b.style.setProperty('--couleur', e.couleur);
      b.setAttribute('aria-pressed', String(choisies.has(e.id)));
      b.title = e.libelle;
      b.innerHTML = `<span class="pastille" aria-hidden="true"></span>${echapper(e.court)} <span class="nb">${nb}</span>`;
      b.disabled = nb === 0 && acteurs.length > 0;
      b.addEventListener('click', () => {
        choisies.has(e.id) ? choisies.delete(e.id) : choisies.add(e.id);
        b.setAttribute('aria-pressed', String(choisies.has(e.id)));
        actualiser();
      });
      zoneFiltres.append(b);
    }
  }

  /** Menus Domaine et Activité : visibles seulement avec l'étiquette Musique, valeurs présentes uniquement. */
  function dessinerSousFiltres() {
    const musique = acteurs.filter((a) => a.properties.etiquettes?.includes('musique'));
    const domaines = new Map();
    const acts = new Map();
    for (const a of musique) {
      const p = a.properties;
      if (p.domaine_musique) domaines.set(p.domaine_musique, (domaines.get(p.domaine_musique) || 0) + 1);
      for (const l of p.activites_musique || []) { const id = idActivite(l); if (id) acts.set(id, (acts.get(id) || 0) + 1); }
    }
    if (domaine && !domaines.has(domaine)) domaine = '';
    if (activite && !acts.has(activite)) activite = '';
    const option = (val, texte, nb, choisi) => `<option value="${echapper(val)}"${choisi ? ' selected' : ''}>${echapper(texte)}${nb ? ` (${nb})` : ''}</option>`;
    choixDomaine.innerHTML = option('', 'Tous') + [...domaines]
      .sort((x, y) => x[0].localeCompare(y[0], 'fr')).map(([d, n]) => option(d, d, n, d === domaine)).join('');
    choixActivite.innerHTML = option('', 'Toutes') + activites
      .filter((x) => acts.has(x.id)).map((x) => option(x.id, x.court, acts.get(x.id), x.id === activite)).join('');
    choixDomaine.parentElement.hidden = domaines.size === 0;
    choixActivite.parentElement.hidden = acts.size === 0;
    sousFiltres.hidden = !choisies.has('musique') || (domaines.size === 0 && acts.size === 0);
  }

  /** Menu Activité (bibliothèques) : visible seulement avec l'étiquette Bibliothèque numérique. */
  function dessinerSousFiltresBibliotheque() {
    const nb = new Map();
    for (const a of acteurs) {
      if (!a.properties.etiquettes?.includes('bibliotheque')) continue;
      for (const l of a.properties.services_bibliotheque || []) {
        const id = services.find((x) => x.libelle === l)?.id;
        if (id) nb.set(id, (nb.get(id) || 0) + 1);
      }
    }
    if (service && !nb.has(service)) service = '';
    choixService.innerHTML = `<option value="">Tous</option>` + services.filter((x) => nb.has(x.id))
      .map((x) => `<option value="${echapper(x.id)}"${x.id === service ? ' selected' : ''}>${echapper(x.court)} (${nb.get(x.id)})</option>`).join('');
    sousFiltresBib.hidden = !choisies.has('bibliotheque') || nb.size === 0;
  }
  choixService.addEventListener('change', () => { service = choixService.value; actualiser(); });

  choixDomaine.addEventListener('change', () => { domaine = choixDomaine.value; actualiser(); });
  choixActivite.addEventListener('change', () => { activite = choixActivite.value; actualiser(); });

  function actualiser() {
    if (!choisies.has('musique')) { domaine = ''; activite = ''; }
    if (!choisies.has('bibliotheque')) service = '';
    dessinerSousFiltres();
    dessinerSousFiltresBibliotheque();
    const visibles = acteurs.filter(correspond);
    calque.clearLayers();
    liste.innerHTML = '';

    for (const a of visibles) {
      calque.addLayer(a.marqueur);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item' + (a === actif ? ' actif' : '');
      b.innerHTML = `${htmlMarque(a.properties.etiquettes || [])}<strong>${echapper(a.properties.nom)}</strong>
        <span class="meta">${echapper(a.properties.commune)}${a.properties.reseaux?.length ? ' · ' + echapper(a.properties.reseaux[0]) : ''}</span>`;
      b.addEventListener('click', () => ouvrir(a, true));
      a.bouton = b;
      li.append(b);
      liste.append(li);
    }

    if (!acteurs.length) {
      liste.innerHTML = `<li class="vide">La carte est en cours d’alimentation : aucun acteur n’est encore référencé.<br>
        <a href="${echapper(urlFormulaire('ajout-acteur.yml'))}">Proposer le premier acteur</a></li>`;
    } else if (!visibles.length) {
      liste.innerHTML = '<li class="vide">Aucun acteur ne correspond à ces critères.</li>';
    }

    const total = acteurs.length;
    compteur.textContent = visibles.length === total
      ? `${total} acteur${total > 1 ? 's' : ''}`
      : `${visibles.length} acteur${visibles.length > 1 ? 's' : ''} sur ${total}`;
    el('poignee-texte').textContent = `Liste des acteurs (${visibles.length})`;
    toutAfficher.hidden = !choisies.size && !recherche && !domaine && !activite && !service;
    compterParCommune(visibles);
    ecrireUrl();
  }

  function ouvrir(a, depuisListe) {
    if (actif?.marqueur) actif.marqueur.getElement()?.classList.remove('marqueur-actif');
    actif = a;
    liste.querySelectorAll('.item.actif').forEach((n) => n.classList.remove('actif'));
    a.bouton?.classList.add('actif');
    if (depuisListe) {
      if (estMobile()) basculerPanneau(false);
      carte.setView(a.marqueur.getLatLng(), Math.max(carte.getZoom(), 13));
    } else {
      a.bouton?.scrollIntoView({ block: 'nearest' });
    }
    a.marqueur.openPopup();
    a.marqueur.getElement()?.classList.add('marqueur-actif');
  }

  function basculerPanneau(ouvrirPanneau = !panneau.classList.contains('ouvert')) {
    panneau.classList.toggle('ouvert', ouvrirPanneau);
    poignee.setAttribute('aria-expanded', String(ouvrirPanneau));
  }
  poignee.addEventListener('click', () => basculerPanneau());
  champ.addEventListener('focus', () => { if (estMobile()) basculerPanneau(true); });

  let minuterie;
  champ.addEventListener('input', () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => { recherche = champ.value.trim(); actualiser(); }, 150);
  });
  toutAfficher.addEventListener('click', () => {
    choisies.clear();
    recherche = '';
    domaine = '';
    activite = '';
    service = '';
    champ.value = '';
    dessinerFiltres();
    actualiser();
  });

  // ---------- Chargement ----------
  async function charger() {
    const [ref, donnees] = await Promise.all([
      fetch('data/etiquettes.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/acteurs.geojson', { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    etiquettes = ref.etiquettes;
    activites = ref.activites_musique || [];
    services = ref.services_bibliotheque || [];
    parId = new Map(etiquettes.map((e) => [e.id, e]));
    acteurs = (donnees.features || [])
      .filter((f) => f?.geometry?.type === 'Point')
      .sort((a, b) => a.properties.nom.localeCompare(b.properties.nom, 'fr'));

    for (const a of acteurs) {
      const [lon, lat] = a.geometry.coordinates;
      a.marqueur = L.marker([lat, lon], {
        title: a.properties.nom,
        alt: a.properties.nom,
        riseOnHover: true,
        icon: L.divIcon({ className: 'marqueur', html: htmlMarque(a.properties.etiquettes || []), iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] }),
      }).bindPopup(() => htmlFiche(a), { maxWidth: 340, autoPanPadding: [24, 24] });
      a.marqueur.on('click', () => ouvrir(a, false));
      a.marqueur.on('popupclose', () => a.marqueur.getElement()?.classList.remove('marqueur-actif'));
    }

    lireUrl();
    dessinerFiltres();
    actualiser();
    if (communesVisibles || teinte) majCalqueCommunes().catch((e) => { console.error(e); communesVisibles = false; teinte = ''; majCalqueCommunes(); });
    if (acteurs.length) {
      const visibles = acteurs.filter(correspond);
      const groupe = L.featureGroup((visibles.length ? visibles : acteurs).map((a) => a.marqueur));
      // Sur mobile, le tiroir masque le bas de l'écran : on décale le cadrage.
      carte.fitBounds(groupe.getBounds(), estMobile()
        ? { paddingTopLeft: [30, 30], paddingBottomRight: [30, 175], maxZoom: 13 }
        : { padding: [40, 40], maxZoom: 13 });
    }
  }

  charger().catch((e) => {
    console.error(e);
    liste.innerHTML = '<li class="vide">Impossible de charger les données. Réessayez dans quelques instants.</li>';
  });
})();
