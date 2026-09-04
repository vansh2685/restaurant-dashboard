# Restaurant Analytics Dashboard

A restaurant analytics dashboard with a real backend: a Node.js/Express API
reads `data/Dataset_.csv` and does all filtering and aggregation server-side;
the frontend (plain HTML, CSS, and vanilla JavaScript) fetches that data and
renders it with Chart.js. No data is embedded in the page — every number is
computed fresh by the server on each request.

## Project structure

```
restaurant-dashboard/
├── server.js            Express API + static file server
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── data/
│   └── Dataset_.csv      your dataset — swap this file to point the dashboard at different data
└── public/
    ├── index.html
    ├── style.css
    ├── app.js             fetches from the API and draws the charts
    └── vendor/
        └── chart.umd.js   Chart.js, bundled locally — no CDN/internet needed to render charts
```

## Run it

### Option A — Node directly

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

(Set a different port with `PORT=4000 npm start` if 3000 is taken.)

### Option B — Docker Compose (recommended)

```bash
docker compose up --build
```

Then open **http://localhost:3000**. Stop it with `docker compose down`.

The dataset folder (`./data`) is mounted into the container read-only, so you
can drop in a new `Dataset_.csv` and just restart the container
(`docker compose restart`) — no rebuild needed.

### Option C — Plain Docker

```bash
docker build -t restaurant-analytics-dashboard .
docker run -p 3000:3000 -v "$(pwd)/data:/app/data:ro" restaurant-analytics-dashboard
```

To run on a different host port: `docker run -p 4000:3000 ...` and open
`http://localhost:4000`.

## API

| Endpoint | Description |
|---|---|
| `GET /api/meta` | Total restaurant count, list of countries with counts, max vote count in the dataset. |
| `GET /api/cities?country=<name\|all>` | Cities for a given country (or all), sorted by restaurant count. |
| `GET /api/dashboard?country=&city=&price=&minVotes=` | Full dashboard payload for the current filter selection: KPIs, rating histogram, price/rating breakdown, votes-vs-rating scatter, top cities, geo points by rating band, top cuisines, highest-rated cuisines, and table booking/online delivery by price tier. |

All query parameters are optional; omit or pass `all` to mean "no filter" on
that dimension.

## Using your own data

Replace `data/Dataset_.csv` with any CSV that has the same columns
(`Restaurant Name`, `Country Code`, `City`, `Cuisines`, `Average Cost for two`,
`Has Table booking`, `Has Online delivery`, `Price range`, `Aggregate rating`,
`Votes`, `Latitude`, `Longitude`) and restart the server — the country-code
lookup table is in `server.js` if you need to add more countries.

## Troubleshooting

The server now fails loudly with a specific message instead of doing nothing,
so start by actually running it in a terminal and reading the output.

**"API unreachable — is the server running?" / charts never load**
You opened `public/index.html` directly by double-clicking it (a `file://`
URL). The page needs to be served by the backend so its `fetch()` calls have
somewhere to go. Run `npm start` (or `docker compose up`) and open
**http://localhost:3000** — not the HTML file itself.

**Dashboard stuck on "loading dataset…" / "Loading…" in the country dropdown,
nothing ever appears, no visible error**
This happens if a required script failed to load. As of this version, Chart.js
is bundled locally at `public/vendor/chart.umd.js` specifically so this can't
be caused by a blocked CDN — but if you're on an older copy of this project,
or `public/vendor/chart.umd.js` is missing/corrupted, that's the cause. The
page will now show a visible red error box naming the problem instead of
staying silently blank. Fix: make sure `public/vendor/chart.umd.js` exists
(re-download the project if not) and check the browser console (F12) for the
exact failed request.

**`Error: Cannot find module 'express'` (or `csv-parse`)**
Dependencies aren't installed. Run `npm install` in the project folder first.

**`Port 3000 is already in use`**
Something else is already listening on that port. Either stop it, or run this
app on a different port: `PORT=4000 npm start`, then open
`http://localhost:4000`. For Docker, change the left-hand side of `"3000:3000"`
in `docker-compose.yml` (e.g. `"4000:3000"`) or run
`docker run -p 4000:3000 ...`.

**`Dataset not found at ".../data/Dataset_.csv"`**
The `data` folder or the CSV inside it is missing, or the filename doesn't
match exactly (case-sensitive on Linux/macOS). Make sure it's named exactly
`Dataset_.csv`.

**`... is missing expected column(s): ...`**
Your CSV doesn't have the columns the backend expects — see "Using your own
data" above for the required column names.

**Docker: `Cannot connect to the Docker daemon`**
Docker Desktop (or the Docker service) isn't running. Start it, then retry
`docker compose up --build`.

**Everything starts but the page is blank / stuck on "loading dataset…"**
Open your browser's DevTools console (F12) — a network error there (e.g. a
blocked request, wrong port, or an ad-blocker/extension interfering) will
tell you exactly what's failing. The API endpoints (`/api/meta`,
`/api/dashboard`) can also be opened directly in a browser tab to check they
return JSON.

If none of these match what you're seeing, copy the exact error text from the
terminal (or the browser console) — that pinpoints the fix immediately.
