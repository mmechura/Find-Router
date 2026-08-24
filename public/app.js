const dateInput = document.getElementById('date-input');
const latInput = document.getElementById('lat-input');
const lonInput = document.getElementById('lon-input');
const locateBtn = document.getElementById('locate-btn');
const generateBtn = document.getElementById('generate-btn');
const statusMessage = document.getElementById('status-message');
const stravaStatus = document.getElementById('strava-status');
const stravaConnect = document.getElementById('strava-connect');
const workoutPanel = document.getElementById('workout-panel');
const workoutDetails = document.getElementById('workout-details');
const routePanel = document.getElementById('route-panel');
const routeDetails = document.getElementById('route-details');
const plannerLink = document.getElementById('planner-link');
const repeatPanel = document.getElementById('repeat-panel');
const repeatDetails = document.getElementById('repeat-details');
const repeatPlannerLink = document.getElementById('repeat-planner-link');
const calendarList = document.getElementById('calendar-list');
const calendarIcsLink = document.getElementById('calendar-ics-link');
const addressInput = document.getElementById('address-input');
const addressSearchBtn = document.getElementById('address-search-btn');
const addressResults = document.getElementById('address-results');
const speedInput = document.getElementById('speed-input');
const speedSourceHint = document.getElementById('speed-source-hint');
const previewPanel = document.getElementById('preview-panel');
const previewDetails = document.getElementById('preview-details');
const menuBtn = document.getElementById('menu-btn');
const sideNav = document.getElementById('side-nav');
const navBackdrop = document.getElementById('nav-backdrop');
const archiveList = document.getElementById('archive-list');
const archiveDetailPanel = document.getElementById('archive-detail-panel');
const archiveDetailTitle = document.getElementById('archive-detail-title');
const archiveDetailDetails = document.getElementById('archive-detail-details');
const archivePlannerLink = document.getElementById('archive-planner-link');
const archiveRepeatBlock = document.getElementById('archive-repeat-block');
const archiveRepeatDetails = document.getElementById('archive-repeat-details');
const archiveRepeatPlannerLink = document.getElementById('archive-repeat-planner-link');

dateInput.value = new Date().toISOString().slice(0, 10);

// Map previews use OpenStreetMap tiles (no API key needed, always works).
// The route itself is computed via the Mapy.com Routing API and handed off
// to Mapy.com's own planner for the final view + GPX export - see README
// for why the preview basemap and the routing/export provider differ.
const maps = {}; // elementId -> { map, layer }

function ensureMap(elementId) {
  if (maps[elementId]) return maps[elementId].map;
  const map = L.map(elementId).setView([50.0755, 14.4378], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
  maps[elementId] = { map, layer: null };
  return map;
}

function drawRoute(elementId, route) {
  const map = ensureMap(elementId);
  const entry = maps[elementId];
  if (entry.layer) map.removeLayer(entry.layer);
  const latlngs = route.geometry.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  entry.layer = L.polyline(latlngs, { color: '#1c6f3a', weight: 4 }).addTo(map);
  map.fitBounds(entry.layer.getBounds(), { padding: [20, 20] });
}

function renderDetails(container, rows) {
  container.innerHTML = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    container.append(dt, dd);
  }
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? '#b00020' : 'inherit';
}

async function refreshStravaStatus() {
  try {
    const res = await fetch('/auth/strava/status');
    const data = await res.json();
    if (data.connected) {
      const name = data.athlete ? `${data.athlete.firstname ?? ''} ${data.athlete.lastname ?? ''}`.trim() : '';
      stravaStatus.textContent = `Připojeno${name ? ' jako ' + name : ''}.`;
      stravaConnect.textContent = 'Připojit znovu';
    } else {
      stravaStatus.textContent = 'Strava zatím není připojena (volitelné, zpřesní odhad tempa a únavy).';
    }
  } catch {
    stravaStatus.textContent = 'Nepodařilo se zjistit stav připojení Strava.';
  }
}

async function loadCalendar() {
  try {
    const res = await fetch('/api/workout/calendar');
    const data = await res.json();
    if (!res.ok) {
      calendarList.innerHTML = `<li class="muted">${data.error || 'Kalendář se nepodařilo načíst.'}</li>`;
      return;
    }
    calendarIcsLink.href = `/api/workout/calendar.ics?from=${data.from}&to=${data.to}`;
    if (data.workouts.length === 0) {
      calendarList.innerHTML = '<li class="muted">Žádné naplánované tréninky v nejbližších dvou týdnech.</li>';
      return;
    }
    calendarList.innerHTML = '';
    for (const workout of data.workouts) {
      const li = document.createElement('li');
      const distance = workout.distanceM ? `${(workout.distanceM / 1000).toFixed(1)} km` : '';
      const duration = workout.movingTimeS ? `${Math.round(workout.movingTimeS / 60)} min` : '';
      li.textContent = `${workout.date} - ${workout.name}${distance || duration ? ` (${[distance, duration].filter(Boolean).join(', ')})` : ''}`;
      li.addEventListener('click', () => {
        dateInput.value = workout.date;
        setStatus(`Datum nastaveno na ${workout.date}.`);
        schedulePreview();
      });
      calendarList.append(li);
    }
  } catch {
    calendarList.innerHTML = '<li class="muted">Kalendář se nepodařilo načíst.</li>';
  }
}

async function searchAddress() {
  const query = addressInput.value.trim();
  if (!query) return;
  addressResults.hidden = false;
  addressResults.innerHTML = '<li class="muted">Hledám…</li>';
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!res.ok) {
      addressResults.innerHTML = `<li class="muted">${data.error || 'Hledání selhalo.'}</li>`;
      return;
    }
    if (data.results.length === 0) {
      addressResults.innerHTML = '<li class="muted">Nic nenalezeno.</li>';
      return;
    }
    addressResults.innerHTML = '';
    for (const result of data.results) {
      const li = document.createElement('li');
      li.textContent = result.label;
      li.addEventListener('click', () => {
        latInput.value = result.lat.toFixed(6);
        lonInput.value = result.lon.toFixed(6);
        addressResults.hidden = true;
        setStatus(`Start nastaven na "${result.label}".`);
        schedulePreview();
      });
      addressResults.append(li);
    }
  } catch (err) {
    addressResults.innerHTML = `<li class="muted">Chyba: ${err.message}</li>`;
  }
}

async function prefillDefaultAddress() {
  const query = addressInput.value.trim();
  if (!query || latInput.value || lonInput.value) return;
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (res.ok && data.results.length > 0) {
      latInput.value = data.results[0].lat.toFixed(6);
      lonInput.value = data.results[0].lon.toFixed(6);
      schedulePreview();
    }
  } catch {
    // Tichý no-op — výchozí adresu si uživatel může doplnit/opravit ručně.
  }
}

addressSearchBtn.addEventListener('click', searchAddress);
addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchAddress();
  }
});

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Tento prohlížeč nepodporuje geolokaci.', true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latInput.value = pos.coords.latitude.toFixed(6);
      lonInput.value = pos.coords.longitude.toFixed(6);
      schedulePreview();
    },
    (err) => setStatus(`Nepodařilo se zjistit polohu: ${err.message}`, true),
  );
});

let speedTouchedByUser = false;
let previewDebounceTimer = null;

function renderPreview(request) {
  previewPanel.hidden = false;
  const rows = [
    ['Cílová vzdálenost', `${request.targetDistanceKm.toFixed(2)} km`],
    ['Použitá rychlost', `${request.paceKmh.toFixed(1)} km/h`],
  ];
  if (request.warmupKm) rows.push(['Rozcvička', `${request.warmupKm.toFixed(2)} km`]);
  if (request.cooldownKm) rows.push(['Vyklusání', `${request.cooldownKm.toFixed(2)} km`]);
  if (request.repeatSegmentKm) rows.push(['Opakovací úsek', `${request.repeatSegmentKm.toFixed(2)} km`]);
  rows.push(['Preferovaný terén', request.preferFlat ? 'spíš rovina' : 'kopce v pořádku']);
  renderDetails(previewDetails, rows);
}

async function loadPreview() {
  const lat = parseFloat(latInput.value);
  const lon = parseFloat(lonInput.value);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    previewPanel.hidden = true;
    return;
  }

  const surface = document.querySelector('input[name="surface"]:checked')?.value || 'road';
  const terrain = document.querySelector('input[name="terrain"]:checked')?.value || 'auto';
  const speedKmh = speedTouchedByUser && speedInput.value ? parseFloat(speedInput.value) : undefined;

  try {
    const res = await fetch('/api/route/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateInput.value, lat, lon, surface, terrain, speedKmh }),
    });
    const data = await res.json();
    if (!res.ok) {
      previewPanel.hidden = true;
      return;
    }
    renderWorkout(data.workout);
    renderPreview(data.request);
    if (!speedTouchedByUser) {
      speedInput.value = data.request.paceKmh.toFixed(1);
      speedSourceHint.textContent = data.readiness?.recentAvgSpeedKmh
        ? '(odhad z posledních tréninků na Strava)'
        : '(výchozí hodnota appky)';
    } else {
      speedSourceHint.textContent = '(tvoje vlastní hodnota)';
    }
  } catch {
    previewPanel.hidden = true;
  }
}

function schedulePreview() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(loadPreview, 400);
}

speedInput.addEventListener('input', () => {
  speedTouchedByUser = true;
  schedulePreview();
});
dateInput.addEventListener('change', schedulePreview);
latInput.addEventListener('input', schedulePreview);
lonInput.addEventListener('input', schedulePreview);
document.querySelectorAll('input[name="surface"]').forEach((el) => el.addEventListener('change', schedulePreview));
document.querySelectorAll('input[name="terrain"]').forEach((el) => el.addEventListener('change', schedulePreview));

function renderWorkout(workout) {
  workoutPanel.hidden = false;
  renderDetails(workoutDetails, [
    ['Název', workout.name],
    ['Typ', workout.type],
    ['Vzdálenost', workout.distanceM ? `${(workout.distanceM / 1000).toFixed(1)} km` : '—'],
    ['Délka', workout.movingTimeS ? `${Math.round(workout.movingTimeS / 60)} min` : '—'],
    ['Popis', workout.description || '—'],
  ]);
}

function renderRoute(route, plannerUrl) {
  routePanel.hidden = false;
  renderDetails(routeDetails, [
    ['Vygenerovaná vzdálenost', `${route.actualDistanceKm.toFixed(2)} km`],
    ['Odhadovaný čas', `${Math.round(route.durationS / 60)} min`],
    ['Profil trasy', route.profile],
    ['Iterací do shody', String(route.iterations)],
  ]);
  drawRoute('map', route);
  plannerLink.href = plannerUrl;
}

function renderRepeatRoute(route, plannerUrl) {
  if (!route) {
    repeatPanel.hidden = true;
    return;
  }
  repeatPanel.hidden = false;
  renderDetails(repeatDetails, [
    ['Délka jednoho okruhu', `${route.actualDistanceKm.toFixed(2)} km`],
    ['Odhadovaný čas okruhu', `${Math.round(route.durationS / 60)} min`],
    ['Profil trasy', route.profile],
  ]);
  drawRoute('repeat-map', route);
  repeatPlannerLink.href = plannerUrl;
}

generateBtn.addEventListener('click', async () => {
  const lat = parseFloat(latInput.value);
  const lon = parseFloat(lonInput.value);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    setStatus('Zadej výchozí bod (nebo klikni na "Použít moji polohu").', true);
    return;
  }

  setStatus('Generuji trasu…');
  generateBtn.disabled = true;
  try {
    const surface = document.querySelector('input[name="surface"]:checked')?.value || 'road';
    const terrain = document.querySelector('input[name="terrain"]:checked')?.value || 'auto';
    const speedKmh = speedInput.value ? parseFloat(speedInput.value) : undefined;
    const res = await fetch('/api/route/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateInput.value, lat, lon, surface, terrain, speedKmh }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || 'Generování trasy selhalo.', true);
      return;
    }
    renderWorkout(data.workout);
    renderRoute(data.route, data.plannerUrl);
    renderRepeatRoute(data.repeatRoute, data.repeatPlannerUrl);
    setStatus('Hotovo.');
  } catch (err) {
    setStatus(`Chyba: ${err.message}`, true);
  } finally {
    generateBtn.disabled = false;
  }
});

// ---------- Hamburger nav ----------

function openNav() {
  sideNav.hidden = false;
  navBackdrop.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
}

function closeNav() {
  sideNav.hidden = true;
  navBackdrop.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}

function showView(viewName) {
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.dataset.view === viewName));
  document.querySelectorAll('.nav-link').forEach((el) => el.classList.toggle('active', el.dataset.view === viewName));
  if (viewName === 'archive') loadArchive();
}

menuBtn.addEventListener('click', () => (sideNav.hidden ? openNav() : closeNav()));
navBackdrop.addEventListener('click', closeNav);
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    showView(link.dataset.view);
    closeNav();
  });
});

// ---------- Archiv tras ----------

function formatArchiveRow(entry) {
  const sportLabel = entry.sport === 'bike' ? 'kolo' : 'běh';
  return `${entry.workoutDate} - ${entry.workoutName} (${entry.actualDistanceKm.toFixed(1)} km, ${sportLabel})${entry.hasRepeatRoute ? ' <span class="badge">+ intervaly</span>' : ''}`;
}

async function loadArchive() {
  archiveList.innerHTML = '<li class="muted">Načítám…</li>';
  archiveDetailPanel.hidden = true;
  try {
    const res = await fetch('/api/routes');
    const data = await res.json();
    if (!res.ok) {
      archiveList.innerHTML = `<li class="muted">${data.error || 'Archiv se nepodařilo načíst.'}</li>`;
      return;
    }
    if (data.routes.length === 0) {
      archiveList.innerHTML = '<li class="muted">Zatím žádné vygenerované trasy.</li>';
      return;
    }
    archiveList.innerHTML = '';
    for (const entry of data.routes) {
      const li = document.createElement('li');
      li.innerHTML = formatArchiveRow(entry);
      li.addEventListener('click', () => openArchiveEntry(entry.id));
      archiveList.append(li);
    }
  } catch {
    archiveList.innerHTML = '<li class="muted">Archiv se nepodařilo načíst.</li>';
  }
}

async function openArchiveEntry(id) {
  try {
    const res = await fetch(`/api/routes/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || 'Trasu se nepodařilo načíst.', true);
      return;
    }

    archiveDetailPanel.hidden = false;
    archiveDetailTitle.textContent = `${data.workoutName} (${data.workoutDate})`;
    renderDetails(archiveDetailDetails, [
      ['Vzdálenost', `${data.route.actualDistanceKm.toFixed(2)} km`],
      ['Odhadovaný čas', `${Math.round(data.route.durationS / 60)} min`],
      ['Profil trasy', data.route.profile],
      ['Uloženo', new Date(data.createdAt).toLocaleString('cs-CZ')],
    ]);
    drawRoute('archive-map', data.route);
    archivePlannerLink.href = data.plannerUrl;

    if (data.repeatRoute) {
      archiveRepeatBlock.hidden = false;
      renderDetails(archiveRepeatDetails, [
        ['Délka okruhu', `${data.repeatRoute.actualDistanceKm.toFixed(2)} km`],
        ['Odhadovaný čas', `${Math.round(data.repeatRoute.durationS / 60)} min`],
      ]);
      drawRoute('archive-repeat-map', data.repeatRoute);
      archiveRepeatPlannerLink.href = data.repeatPlannerUrl;
    } else {
      archiveRepeatBlock.hidden = true;
    }

    archiveDetailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(`Chyba: ${err.message}`, true);
  }
}

refreshStravaStatus();
loadCalendar();
prefillDefaultAddress();
