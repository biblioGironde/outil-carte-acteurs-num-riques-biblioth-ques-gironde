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

  // ---------- État ----------
  let etiquettes = [];
  let parId = new Map();
  let acteurs = [];
  const choisies = new Set();
  let recherche = '';
  let activites = [];          // référentiel des activités musicales
  let domaine = '';            // filtre Musique : domaine (libellé)
  let activite = '';           // filtre Musique : activité (identifiant)
  const libelleActivite = (id) => activites.find((x) => x.id === id)?.libelle;
  const idActivite = (libelle) => activites.find((x) => x.libelle === libelle)?.id;
  let actif = null;

  function lireUrl() {
    const p = new URLSearchParams(location.search);
    (p.get('etiquettes') || '').split(',').filter(Boolean).forEach((e) => choisies.add(e));
    recherche = p.get('q') || '';
    champ.value = recherche;
    domaine = p.get('domaine') || '';
    activite = p.get('activite') || '';
  }
  function ecrireUrl() {
    const p = new URLSearchParams();
    if (choisies.size) p.set('etiquettes', [...choisies].join(','));
    if (recherche) p.set('q', recherche);
    if (choisies.has('musique') && domaine) p.set('domaine', domaine);
    if (choisies.has('musique') && activite) p.set('activite', activite);
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

  function correspond(a) {
    const p = a.properties;
    const tags = p.etiquettes || [];
    if (choisies.size && !tags.some((e) => choisies.has(e))) return false;
    // Le filtre Musique ne s'applique qu'aux acteurs retenus au titre de l'étiquette Musique.
    if (filtreMusiqueActif() && !tags.some((e) => e !== 'musique' && choisies.has(e)) && !correspondMusique(p)) return false;
    if (!recherche) return true;
    const texte = normaliser([p.nom, p.commune, p.code_postal, p.description, ...(p.reseaux || []),
      p.domaine_musique, ...(p.activites_musique || [])].join(' '));
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

  choixDomaine.addEventListener('change', () => { domaine = choixDomaine.value; actualiser(); });
  choixActivite.addEventListener('change', () => { activite = choixActivite.value; actualiser(); });

  function actualiser() {
    if (!choisies.has('musique')) { domaine = ''; activite = ''; }
    dessinerSousFiltres();
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
    toutAfficher.hidden = !choisies.size && !recherche && !domaine && !activite;
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
    if (acteurs.length) {
      const visibles = acteurs.filter(correspond);
      const groupe = L.featureGroup((visibles.length ? visibles : acteurs).map((a) => a.marqueur));
      // Sur mobile, le tiroir masque le bas de l'écran : on décale le cadrage.
      carte.fitBounds(groupe.getBounds(), estMobile()
        ? { paddingTopLeft: [30, 30], paddingBottomRight: [30, 150], maxZoom: 13 }
        : { padding: [40, 40], maxZoom: 13 });
    }
  }

  charger().catch((e) => {
    console.error(e);
    liste.innerHTML = '<li class="vide">Impossible de charger les données. Réessayez dans quelques instants.</li>';
  });
})();
