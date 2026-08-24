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

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Tento prohlížeč nepodporuje geolokaci.', true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latInput.value = pos.coords.latitude.toFixed(6);
      lonInput.value = pos.coords.longitude.toFixed(6);
    },
    (err) => setStatus(`Nepodařilo se zjistit polohu: ${err.message}`, true),
  );
});

function renderWorkout(workout) {
  workoutPanel.hidden = false;
  workoutDetails.innerHTML = '';
  const rows = [
    ['Název', workout.name],
    ['Typ', workout.type],
    ['Vzdálenost', workout.distanceM ? `${(workout.distanceM / 1000).toFixed(1)} km` : '—'],
    ['Délka', workout.movingTimeS ? `${Math.round(workout.movingTimeS / 60)} min` : '—'],
    ['Popis', workout.description || '—'],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    workoutDetails.append(dt, dd);
  }
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
    const res = await fetch('/api/route/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateInput.value, lat, lon }),
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

refreshStravaStatus();
