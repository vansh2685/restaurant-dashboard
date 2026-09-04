const express = require("express");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const app = express();
const PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------
// Load & prepare the dataset once at startup
// ---------------------------------------------------------------------
const CSV_PATH = path.join(__dirname, "data", "Dataset_.csv");

const COUNTRY_MAP = {
  1: "India", 14: "Australia", 30: "Brazil", 37: "Canada", 94: "Indonesia",
  148: "New Zealand", 162: "Philippines", 166: "Qatar", 184: "Singapore",
  189: "South Africa", 191: "Sri Lanka", 208: "Turkey", 214: "UAE",
  215: "United Kingdom", 216: "United States"
};

function loadDataset() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `Dataset not found at "${CSV_PATH}".\n` +
      `  → Make sure a file named exactly "Dataset_.csv" exists inside the "data" folder\n` +
      `    next to server.js (case-sensitive on Linux/macOS).`
    );
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true
  });

  if (rows.length === 0) {
    throw new Error(`"${CSV_PATH}" was read but contains no data rows.`);
  }

  const REQUIRED_COLUMNS = [
    "Restaurant Name", "Country Code", "City", "Cuisines",
    "Average Cost for two", "Has Table booking", "Has Online delivery",
    "Price range", "Aggregate rating", "Votes", "Latitude", "Longitude"
  ];
  const actualColumns = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !actualColumns.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `"${CSV_PATH}" is missing expected column(s): ${missing.join(", ")}.\n` +
      `  → Found columns: ${actualColumns.join(", ")}`
    );
  }

  return rows.map((r) => {
    const cuisines = (r["Cuisines"] || "Not Available").trim();
    const primaryCuisine = cuisines.split(",")[0].trim();
    const countryCode = Number(r["Country Code"]);
    return {
      name: r["Restaurant Name"],
      country: COUNTRY_MAP[countryCode] || "Other",
      city: r["City"],
      cuisine: primaryCuisine,
      price: Number(r["Price range"]),
      cost: Number(r["Average Cost for two"]),
      rating: Number(r["Aggregate rating"]),
      votes: Number(r["Votes"]),
      tableBooking: r["Has Table booking"] === "Yes",
      onlineDelivery: r["Has Online delivery"] === "Yes",
      lat: Number(r["Latitude"]),
      lng: Number(r["Longitude"])
    };
  });
}

let RESTAURANTS = [];
try {
  RESTAURANTS = loadDataset();
  console.log(`✔ Loaded ${RESTAURANTS.length} restaurants from ${CSV_PATH}`);
} catch (err) {
  console.error("\n✖ Failed to start: could not load the dataset.\n");
  console.error(err.message);
  console.error("\nThe server will not start until this is fixed.\n");
  process.exit(1);
}

// Allow the frontend to call the API even if it's ever served from a
// different origin/port than the backend (e.g. during local development
// with a separate static file server, or a proxy in front of the API).
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function applyFilters(data, query) {
  const { country, city, price, minVotes } = query;
  const minV = Number(minVotes) || 0;

  return data.filter((r) => {
    if (country && country !== "all" && r.country !== country) return false;
    if (city && city !== "all" && r.city !== city) return false;
    if (price && price !== "all" && r.price !== Number(price)) return false;
    if (r.votes < minV) return false;
    return true;
  });
}

function ratingBand(rating) {
  if (rating === 0) return "Not rated";
  if (rating >= 4.5) return "Excellent";
  if (rating >= 4.0) return "Very Good";
  if (rating >= 3.5) return "Good";
  if (rating >= 2.5) return "Average";
  return "Poor";
}

function pearson(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------

// Overall dataset metadata: countries with counts, total restaurants
app.get("/api/meta", (req, res) => {
  const counts = {};
  RESTAURANTS.forEach((r) => { counts[r.country] = (counts[r.country] || 0) + 1; });
  const countries = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    total: RESTAURANTS.length,
    countries,
    maxVotes: Math.max(...RESTAURANTS.map((r) => r.votes))
  });
});

// Cities for a given country (or all), sorted by restaurant count
app.get("/api/cities", (req, res) => {
  const country = req.query.country || "all";
  const pool = country === "all" ? RESTAURANTS : RESTAURANTS.filter((r) => r.country === country);
  const counts = {};
  pool.forEach((r) => { counts[r.city] = (counts[r.city] || 0) + 1; });
  const cities = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.json(cities);
});

// Full dashboard payload for the current filter selection
app.get("/api/dashboard", (req, res) => {
  const data = applyFilters(RESTAURANTS, req.query);

  if (data.length === 0) {
    return res.json({ resultCount: 0, empty: true });
  }

  // --- KPIs ---
  const avgRating = data.reduce((s, r) => s + r.rating, 0) / data.length;
  const nCountries = new Set(data.map((r) => r.country)).size;
  const tbPct = data.filter((r) => r.tableBooking).length / data.length;
  const odPct = data.filter((r) => r.onlineDelivery).length / data.length;

  // --- Rating histogram (0-0.5, 0.5-1, ... 4.5-5) ---
  const histCounts = new Array(10).fill(0);
  data.forEach((r) => { histCounts[Math.min(9, Math.floor(r.rating / 0.5))]++; });
  const histLabels = histCounts.map((_, i) => `${(i * 0.5).toFixed(1)}\u2013${(i * 0.5 + 0.5).toFixed(1)}`);
  const rated = data.filter((r) => r.rating > 0);
  const ratingHistogram = {
    labels: histLabels,
    counts: histCounts,
    avgRated: rated.length ? round(rated.reduce((s, r) => s + r.rating, 0) / rated.length) : 0,
    unrated: data.length - rated.length
  };

  // --- Avg rating by price range ---
  const priceLabels = ["1 \u00b7 Budget", "2 \u00b7 Casual", "3 \u00b7 Upscale", "4 \u00b7 Fine dining"];
  const priceAvgs = [1, 2, 3, 4].map((p) => {
    const group = data.filter((r) => r.price === p);
    return group.length ? round(group.reduce((s, r) => s + r.rating, 0) / group.length) : 0;
  });

  // --- Votes vs rating scatter (log10 votes) ---
  const votesRatingScatter = data
    .filter((r) => r.votes > 0)
    .map((r) => ({ x: round(Math.log10(r.votes + 1), 3), y: r.rating }));
  const scatterCorr = round(pearson(votesRatingScatter.map((p) => p.x), votesRatingScatter.map((p) => p.y)));

  // --- Top cities ---
  const cityCounts = {};
  data.forEach((r) => { cityCounts[r.city] = (cityCounts[r.city] || 0) + 1; });
  const topCities = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([city, count]) => ({ city, count }));

  // --- Geo points grouped by rating band ---
  const geoBands = {};
  data.forEach((r) => {
    if (r.lat === 0 && r.lng === 0) return;
    const band = ratingBand(r.rating);
    (geoBands[band] = geoBands[band] || []).push({ x: round(r.lng, 3), y: round(r.lat, 3) });
  });

  // --- Top cuisines by count ---
  const cuisineCounts = {};
  data.forEach((r) => { cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] || 0) + 1; });
  const topCuisines = Object.entries(cuisineCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cuisine, count]) => ({ cuisine, count }));

  // --- Highest rated cuisines (min sample size) ---
  const cuisineGroups = {};
  data.forEach((r) => { (cuisineGroups[r.cuisine] = cuisineGroups[r.cuisine] || []).push(r.rating); });
  const cuisineRating = Object.entries(cuisineGroups)
    .filter(([, arr]) => arr.length >= 15)
    .map(([cuisine, arr]) => ({
      cuisine,
      avgRating: round(arr.reduce((a, b) => a + b, 0) / arr.length),
      count: arr.length
    }))
    .sort((a, b) => b.avgRating - a.avgRating)
    .slice(0, 10);

  // --- Table booking & online delivery, by price range ---
  const serviceByPrice = {
    labels: priceLabels,
    tableBooking: [1, 2, 3, 4].map((p) => {
      const g = data.filter((r) => r.price === p);
      return g.length ? round((g.filter((r) => r.tableBooking).length / g.length) * 100) : 0;
    }),
    onlineDelivery: [1, 2, 3, 4].map((p) => {
      const g = data.filter((r) => r.price === p);
      return g.length ? round((g.filter((r) => r.onlineDelivery).length / g.length) * 100) : 0;
    })
  };

  res.json({
    resultCount: data.length,
    empty: false,
    kpis: {
      total: data.length,
      avgRating: round(avgRating),
      countries: nCountries,
      tableBookingPct: round(tbPct * 100),
      onlineDeliveryPct: round(odPct * 100)
    },
    ratingHistogram,
    priceRating: { labels: priceLabels, avgs: priceAvgs },
    votesRatingScatter,
    scatterCorr,
    topCities,
    geoBands,
    topCuisines,
    cuisineRating,
    serviceByPrice
  });
});

// ---------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, () => {
  console.log(`\n✔ Restaurant analytics dashboard running at http://localhost:${PORT}\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n✖ Port ${PORT} is already in use.\n`);
    console.error(`  → Stop whatever is using it, or run with a different port, e.g.:`);
    console.error(`      PORT=4000 npm start          (Node)`);
    console.error(`      PORT=4000 docker compose up   (Docker Compose — also update the`);
    console.error(`                                     "ports" line in docker-compose.yml)\n`);
  } else {
    console.error("\n✖ Server failed to start:", err.message, "\n");
  }
  process.exit(1);
});
