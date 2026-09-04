/* ------------------------------------------------------------------
   Frontend for the Restaurant Analytics Dashboard.
   Every number on this page comes from the backend API — nothing is
   computed from a client-side copy of the dataset.
------------------------------------------------------------------- */

// Fail loudly and visibly if Chart.js didn't load, instead of leaving the
// page silently stuck on "Loading…" with no clue why.
if (typeof Chart === 'undefined') {
  document.body.innerHTML =
    '<div style="max-width:640px;margin:80px auto;padding:24px;' +
    'font-family:sans-serif;color:#f3eee3;background:#221c16;' +
    'border:1px solid #c1584f;border-radius:4px;">' +
    '<h2 style="margin-top:0;color:#c1584f;">Chart.js failed to load</h2>' +
    '<p>The dashboard could not load <code>public/vendor/chart.umd.js</code>. ' +
    'Check that the file exists in that folder and that the server has ' +
    'permission to serve it, then reload this page.</p></div>';
  throw new Error('Chart.js not loaded — aborting app.js');
}

const GOLD = '#e8a33d', TEAL = '#4aab98', ROSE = '#c1584f';
const BAND_COLORS = {
  'Excellent': '#2f7a4f',
  'Very Good': '#4aab98',
  'Good': '#e8c23d',
  'Average': '#e8a33d',
  'Poor': '#c1584f',
  'Not rated': '#5a5142'
};

Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
Chart.defaults.color = '#b3a58e';
Chart.defaults.borderColor = '#3c3226';

const gridColor = '#2d271f';
const baseScales = {
  x: { grid: { color: gridColor }, ticks: { font: { size: 11 } } },
  y: { grid: { color: gridColor }, ticks: { font: { size: 11 } } }
};

const CHART_IDS = ['chartRatingHist', 'chartPriceRating', 'chartScatterVotes', 'chartTopCities',
                    'chartGeo', 'chartTopCuisines', 'chartCuisineRating', 'chartService'];
let charts = {};

function fmt(n, d = 1) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: d }); }

function upsertChart(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, config);
}

function destroyAllCharts() {
  CHART_IDS.forEach((id) => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
}

function restoreCanvases() {
  CHART_IDS.forEach((id) => {
    if (!document.getElementById(id)) {
      const body = document.querySelector(`.panel-body[data-canvas="${id}"]`);
      if (body) body.innerHTML = `<canvas id="${id}"></canvas>`;
    }
  });
}

function showGlobalEmptyState() {
  destroyAllCharts();
  CHART_IDS.forEach((id) => {
    const body = document.querySelector(`.panel-body[data-canvas="${id}"]`);
    if (body) body.innerHTML = '<div class="empty-state">No restaurants match the current filters. Try widening a filter.</div>';
  });
  document.getElementById('geoLegend').innerHTML = '';
  document.querySelectorAll('.panel-foot').forEach((el) => (el.innerHTML = ''));
}

/* ---------------- DOM refs ---------------- */
const fCountry = document.getElementById('fCountry');
const fCity = document.getElementById('fCity');
const fPrice = document.getElementById('fPrice');
const fVotes = document.getElementById('fVotes');
const fVotesOut = document.getElementById('fVotesOut');
const resetBtn = document.getElementById('resetBtn');
const resultCount = document.getElementById('resultCount');
const apiStatus = document.getElementById('apiStatus');
const kpiRow = document.getElementById('kpiRow');
const datasetMeta = document.getElementById('datasetMeta');

/* ---------------- bootstrap: load meta, populate country/city dropdowns ---------------- */
async function init() {
  try {
    const meta = await fetchJSON('/api/meta');
    datasetMeta.textContent = `${fmt(meta.total, 0)} restaurants · ${meta.countries.length} countries`;
    fVotes.max = Math.min(2000, meta.maxVotes);

    fCountry.innerHTML = '<option value="all">All countries</option>' +
      meta.countries.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.count})</option>`).join('');

    await refreshCityOptions();
    await render();
  } catch (err) {
    apiStatus.textContent = 'API unreachable — is the server running?';
    apiStatus.className = 'api-status err';
    datasetMeta.textContent = 'could not load dataset';
    console.error(err);
  }
}

async function refreshCityOptions() {
  const country = fCountry.value || 'all';
  const cities = await fetchJSON(`/api/cities?country=${encodeURIComponent(country)}`);
  fCity.innerHTML = '<option value="all">All cities</option>' +
    cities.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.count})</option>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

/* ---------------- events ---------------- */
let voteDebounce;
fVotes.addEventListener('input', () => {
  fVotesOut.textContent = fVotes.value;
  clearTimeout(voteDebounce);
  voteDebounce = setTimeout(render, 150);
});
fCountry.addEventListener('change', async () => { await refreshCityOptions(); render(); });
fCity.addEventListener('change', render);
fPrice.addEventListener('change', render);
resetBtn.addEventListener('click', async () => {
  fCountry.value = 'all';
  await refreshCityOptions();
  fCity.value = 'all';
  fPrice.value = 'all';
  fVotes.value = 0;
  fVotesOut.textContent = '0';
  render();
});

/* ---------------- main render: pull dashboard payload from API ---------------- */
async function render() {
  const params = new URLSearchParams({
    country: fCountry.value || 'all',
    city: fCity.value || 'all',
    price: fPrice.value || 'all',
    minVotes: fVotes.value || 0
  });

  apiStatus.textContent = 'fetching…';
  apiStatus.className = 'api-status';

  let payload;
  try {
    payload = await fetchJSON(`/api/dashboard?${params.toString()}`);
    apiStatus.textContent = '';
  } catch (err) {
    apiStatus.textContent = 'request failed';
    apiStatus.className = 'api-status err';
    console.error(err);
    return;
  }

  resultCount.textContent = fmt(payload.resultCount, 0) + ' matching';

  if (payload.empty) {
    renderKPIs(null);
    showGlobalEmptyState();
    return;
  }

  restoreCanvases();
  renderKPIs(payload.kpis);
  renderRatingHist(payload.ratingHistogram);
  renderPriceRating(payload.priceRating);
  renderScatterVotes(payload.votesRatingScatter, payload.scatterCorr);
  renderTopCities(payload.topCities);
  renderGeo(payload.geoBands);
  renderTopCuisines(payload.topCuisines);
  renderCuisineRating(payload.cuisineRating);
  renderService(payload.serviceByPrice);
}

/* ---------------- KPI strip ---------------- */
function renderKPIs(k) {
  if (!k) {
    kpiRow.innerHTML = ['restaurants in view', 'average rating', 'countries represented', 'take table bookings', 'offer online delivery']
      .map((l) => `<div class="kpi"><span class="num">—</span><span class="lbl">${l}</span></div>`).join('');
    return;
  }
  const items = [
    [fmt(k.total, 0), 'restaurants in view'],
    [fmt(k.avgRating, 2), 'average rating'],
    [fmt(k.countries, 0), 'countries represented'],
    [fmt(k.tableBookingPct, 1) + '%', 'take table bookings'],
    [fmt(k.onlineDeliveryPct, 1) + '%', 'offer online delivery']
  ];
  kpiRow.innerHTML = items.map(([n, l]) => `<div class="kpi"><span class="num">${n}</span><span class="lbl">${l}</span></div>`).join('');
}

/* ---------------- charts ---------------- */
function renderRatingHist(h) {
  upsertChart('chartRatingHist', {
    type: 'bar',
    data: { labels: h.labels, datasets: [{ data: h.counts, backgroundColor: GOLD, borderRadius: 2, maxBarThickness: 28 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => `Rating ${c[0].label}` } } },
      scales: baseScales
    }
  });
  document.getElementById('footRatingHist').innerHTML =
    `Average of <b>${fmt(h.avgRated, 2)}</b> among rated restaurants · <b>${fmt(h.unrated, 0)}</b> not yet rated`;
}

function renderPriceRating(p) {
  upsertChart('chartPriceRating', {
    type: 'bar',
    data: { labels: p.labels, datasets: [{ data: p.avgs, backgroundColor: TEAL, borderRadius: 2, maxBarThickness: 40 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: Object.assign({}, baseScales, { y: { ...baseScales.y, suggestedMax: 5 } })
    }
  });
  const bestIdx = p.avgs.indexOf(Math.max(...p.avgs));
  document.getElementById('footPriceRating').innerHTML =
    `<b>${p.labels[bestIdx].split(' \u00b7 ')[1]}</b> restaurants rate highest on average`;
}

function renderScatterVotes(points, corr) {
  upsertChart('chartScatterVotes', {
    type: 'scatter',
    data: { datasets: [{ data: points, backgroundColor: 'rgba(193,88,79,0.5)', pointRadius: 2.5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `~${Math.round(Math.pow(10, c.parsed.x))} votes · ${c.parsed.y.toFixed(1)} rating` } }
      },
      scales: {
        x: { ...baseScales.x, title: { display: true, text: 'log10(votes)' } },
        y: { ...baseScales.y, min: 0, max: 5, title: { display: true, text: 'rating' } }
      }
    }
  });
  document.getElementById('footScatterVotes').innerHTML =
    `Correlation between vote volume and rating: <b>${fmt(corr, 2)}</b>`;
}

function renderTopCities(top) {
  upsertChart('chartTopCities', {
    type: 'bar',
    data: { labels: top.map((t) => t.city), datasets: [{ data: top.map((t) => t.count), backgroundColor: GOLD, borderRadius: 2 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: baseScales
    }
  });
  document.getElementById('footTopCities').innerHTML =
    top.length ? `<b>${top[0].city}</b> leads with ${fmt(top[0].count, 0)} restaurants in view` : '';
}

function renderGeo(bands) {
  const order = ['Excellent', 'Very Good', 'Good', 'Average', 'Poor', 'Not rated'];
  const datasets = order.filter((b) => bands[b]).map((b) => ({
    label: b, data: bands[b], backgroundColor: BAND_COLORS[b] + 'cc', pointRadius: 2.2
  }));
  upsertChart('chartGeo', {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ...baseScales.x, title: { display: true, text: 'longitude' } },
        y: { ...baseScales.y, title: { display: true, text: 'latitude' } }
      }
    }
  });
  document.getElementById('geoLegend').innerHTML = order.filter((b) => bands[b]).map((b) =>
    `<span class="chip"><i style="background:${BAND_COLORS[b]}"></i>${b}</span>`).join('');
}

function renderTopCuisines(top) {
  upsertChart('chartTopCuisines', {
    type: 'bar',
    data: { labels: top.map((t) => t.cuisine), datasets: [{ data: top.map((t) => t.count), backgroundColor: TEAL, borderRadius: 2 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: baseScales
    }
  });
  document.getElementById('footTopCuisines').innerHTML =
    top.length ? `<b>${top[0].cuisine}</b> is the most-listed primary cuisine` : '';
}

function renderCuisineRating(rows) {
  if (!rows.length) {
    document.querySelector('.panel-body[data-canvas="chartCuisineRating"]').innerHTML =
      '<div class="empty-state">Not enough restaurants per cuisine at this filter level (need 15+).</div>';
    document.getElementById('footCuisineRating').innerHTML = '';
    return;
  }
  upsertChart('chartCuisineRating', {
    type: 'bar',
    data: { labels: rows.map((r) => r.cuisine), datasets: [{ data: rows.map((r) => r.avgRating), backgroundColor: ROSE, borderRadius: 2 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: Object.assign({}, baseScales, { x: { ...baseScales.x, min: 0, max: 5 } })
    }
  });
  document.getElementById('footCuisineRating').innerHTML =
    `<b>${rows[0].cuisine}</b> tops the list at ${fmt(rows[0].avgRating, 2)} avg. rating (${rows[0].count} restaurants)`;
}

function renderService(s) {
  upsertChart('chartService', {
    type: 'bar',
    data: {
      labels: s.labels,
      datasets: [
        { label: 'Table booking', data: s.tableBooking, backgroundColor: GOLD, borderRadius: 2, maxBarThickness: 46 },
        { label: 'Online delivery', data: s.onlineDelivery, backgroundColor: TEAL, borderRadius: 2, maxBarThickness: 46 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11.5 } } } },
      scales: Object.assign({}, baseScales, { y: { ...baseScales.y, suggestedMax: 100, ticks: { callback: (v) => v + '%' } } })
    }
  });
  document.getElementById('footService').innerHTML =
    `Fine dining leans hardest on table booking; delivery skews toward budget &amp; casual spots.`;
}

init();
