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
  let actif = null;

  function lireUrl() {
    const p = new URLSearchParams(location.search);
    (p.get('etiquettes') || '').split(',').filter(Boolean).forEach((e) => choisies.add(e));
    recherche = p.get('q') || '';
    champ.value = recherche;
  }
  function ecrireUrl() {
    const p = new URLSearchParams();
    if (choisies.size) p.set('etiquettes', [...choisies].join(','));
    if (recherche) p.set('q', recherche);
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
      p.specialite_musique && ['Spécialité', echapper(p.specialite_musique)],
      p.reseaux?.length && ['Réseaux', echapper(p.reseaux.join(', '))],
      p.public?.length && ['Publics', echapper(p.public.join(', '))],
    ].filter(Boolean).map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('');
    const verif = p.derniere_verification ? `Vérifié le ${dateFr(p.derniere_verification)}` : (p.date_modification || p.date_ajout ? `Mis à jour le ${dateFr(p.date_modification || p.date_ajout)}` : '');
    const lienModif = urlFormulaire('modification-acteur.yml', { title: `[Modification] ${p.nom}`, identifiant: p.id });
    return `<article class="fiche">
      <h2>${echapper(p.nom)}</h2>
      <div class="etiquettes">${tags}</div>
      ${p.description ? `<p>${echapper(p.description)}</p>` : ''}
      <dl>${lignes}</dl>
      ${contacts ? `<div class="contacts">${contacts}</div>` : ''}
      <p class="technique">${verif ? `${echapper(verif)} · ` : ''}<code>${echapper(p.id)}</code><br>
        <a href="${echapper(lienModif)}" target="_blank" rel="noopener">Proposer une modification</a></p>
    </article>`;
  }

  function correspond(a) {
    const p = a.properties;
    if (choisies.size && !(p.etiquettes || []).some((e) => choisies.has(e))) return false;
    if (!recherche) return true;
    const texte = normaliser([p.nom, p.commune, p.code_postal, p.description, ...(p.reseaux || []), p.specialite_musique].join(' '));
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

  function actualiser() {
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
    toutAfficher.hidden = !choisies.size && !recherche;
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
