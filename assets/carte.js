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
  let populationVisible = false; // teinte des communes selon la population INSEE

  // Classes de population (habitants) et rampe séquentielle bleue, du clair au foncé.
  const SEUILS_POPULATION = [1000, 2000, 5000, 10000, 50000];
  const COULEURS_POPULATION = ['#cce3fd', '#84b9f3', '#338ced', '#2370cd', '#1757ac', '#0e3d7e'];
  const classePopulation = (n) => SEUILS_POPULATION.filter((s) => n >= s).length;
  const habitants = (n) => `${Number(n).toLocaleString('fr-FR')} habitant${n > 1 ? 's' : ''}`;
  function styleCommune(couche) {
    const pop = couche.feature.properties.population;
    return {
      ...STYLE_COMMUNE,
      ...(couche.nb ? STYLE_COMMUNE_OCCUPEE : {}),
      ...(populationVisible && pop != null ? { fillColor: COULEURS_POPULATION[classePopulation(pop)], fillOpacity: 0.72, color: '#ffffff', weight: 0.6, opacity: 0.8 } : {}),
    };
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
          couche.bindTooltip(() => `<strong>${echapper(f.properties.nom)}</strong><br>${f.properties.population != null ? `${habitants(f.properties.population)}<br>` : ''}${couche.nb
            ? `${couche.nb} acteur${couche.nb > 1 ? 's' : ''} affiché${couche.nb > 1 ? 's' : ''}` : 'Aucun acteur affiché'}`,
          { sticky: true, direction: 'top', className: 'infobulle-commune' });
          couche.on('mouseover', () => couche.setStyle(populationVisible ? { weight: 2.2, color: '#0f5e6b', opacity: 0.9 } : STYLE_COMMUNE_SURVOL));
          couche.on('mouseout', () => couche.setStyle(styleCommune(couche)));
          couche.on('click', () => carte.fitBounds(couche.getBounds(), { padding: [30, 30], maxZoom: 14 }));
        },
      });
      compterParCommune(acteurs.filter(correspond));
      return communes;
    });
    return chargementCommunes;
  }

  /** Le fond des communes est affiché dès que l'un des deux calques (contours, population) est actif. */
  async function majCalqueCommunes() {
    boutonCommunes?.setAttribute('aria-pressed', String(communesVisibles));
    boutonPopulation?.setAttribute('aria-pressed', String(populationVisible));
    legendePopulation.hidden = !populationVisible;
    if (communesVisibles || populationVisible) {
      const c = await chargerCommunes();
      c.eachLayer((couche) => couche.setStyle(styleCommune(couche)));
      c.addTo(carte);
    } else communes?.remove();
    ecrireUrl();
  }
  function afficherCommunes(oui) { communesVisibles = oui; return majCalqueCommunes(); }
  function afficherPopulation(oui) { populationVisible = oui; return majCalqueCommunes(); }

  const legendePopulation = document.createElement('div');
  legendePopulation.className = 'legende-population';
  legendePopulation.hidden = true;
  legendePopulation.innerHTML = `<p class="legende-titre">Population (INSEE)</p><ul>${COULEURS_POPULATION.map((c, i) => {
    const bas = SEUILS_POPULATION[i - 1]; const haut = SEUILS_POPULATION[i];
    const f = (n) => n.toLocaleString('fr-FR');
    const texte = i === 0 ? `moins de ${f(haut)}` : haut ? `${f(bas)} à ${f(haut - 1)}` : `${f(bas)} et plus`;
    return `<li><span class="legende-carre" style="background:${c}"></span>${texte}</li>`;
  }).join('')}</ul>`;

  let boutonCommunes;
  let boutonPopulation;
  const ControleCommunes = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar controle-calques');
      boutonCommunes = L.DomUtil.create('button', 'bouton-calque', div);
      boutonCommunes.type = 'button';
      boutonCommunes.setAttribute('aria-pressed', 'false');
      boutonCommunes.title = 'Afficher ou masquer les limites des communes';
      boutonCommunes.innerHTML = '<span class="icone-calque" aria-hidden="true"></span>Communes';
      boutonPopulation = L.DomUtil.create('button', 'bouton-calque', div);
      boutonPopulation.type = 'button';
      boutonPopulation.setAttribute('aria-pressed', 'false');
      boutonPopulation.title = 'Teinter les communes selon leur population (INSEE)';
      boutonPopulation.innerHTML = '<span class="icone-population" aria-hidden="true"></span>Population';
      div.append(legendePopulation);
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      const echec = (e) => { console.error(e); communesVisibles = false; populationVisible = false; majCalqueCommunes(); };
      L.DomEvent.on(boutonCommunes, 'click', () => afficherCommunes(!communesVisibles).catch(echec));
      L.DomEvent.on(boutonPopulation, 'click', () => afficherPopulation(!populationVisible).catch(echec));
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
    populationVisible = p.get('population') === '1';
  }
  function ecrireUrl() {
    const p = new URLSearchParams();
    if (choisies.size) p.set('etiquettes', [...choisies].join(','));
    if (recherche) p.set('q', recherche);
    if (choisies.has('musique') && domaine) p.set('domaine', domaine);
    if (choisies.has('musique') && activite) p.set('activite', activite);
    if (choisies.has('bibliotheque') && service) p.set('service', service);
    if (communesVisibles) p.set('communes', '1');
    if (populationVisible) p.set('population', '1');
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
    if (communesVisibles || populationVisible) majCalqueCommunes().catch((e) => { console.error(e); communesVisibles = false; populationVisible = false; majCalqueCommunes(); });
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
