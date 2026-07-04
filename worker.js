/**
 * Glass Valley Metadata Worker
 * Music: iTunes Search API (keyless)
 * Movies: iTunes Search API (keyless, with retry + caching)
 * Series: TVmaze API (keyless)
 */

const ITUNES_BASE = "https://itunes.apple.com/search";
const TVMAZE_BASE = "https://api.tvmaze.com/search/shows";

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function normalizeMusic(item) {
  return {
    type: "music",
    id: item.trackId,
    title: item.trackName,
    artist: item.artistName || null,
    album: item.collectionName || null,
    artwork: item.artworkUrl100
      ? item.artworkUrl100.replace("100x100", "600x600")
      : null,
    releaseDate: item.releaseDate || null,
    genre: item.primaryGenreName || null,
    previewUrl: item.previewUrl || null,
    trackTimeMillis: item.trackTimeMillis || null,
    storeUrl: item.trackViewUrl || null,
  };
}

function normalizeMovie(item) {
  return {
    type: "movie",
    id: item.trackId || item.collectionId,
    title: item.trackName || item.collectionName,
    artist: item.artistName || null,
    artwork: item.artworkUrl100
      ? item.artworkUrl100.replace("100x100", "600x600")
      : null,
    releaseDate: item.releaseDate || null,
    genre: item.primaryGenreName || null,
    previewUrl: item.previewUrl || null,
    longDescription: item.longDescription || item.shortDescription || null,
    rating: item.contentAdvisoryRating || null,
    storeUrl: item.trackViewUrl || item.collectionViewUrl || null,
  };
}

function normalizeSeries(item) {
  const show = item.show || item;
  return {
    type: "series",
    id: show.id,
    title: show.name,
    overview: show.summary ? show.summary.replace(/<[^>]*>/g, "") : null,
    artwork: show.image ? show.image.original || show.image.medium : null,
    releaseDate: show.premiered || null,
    ended: show.ended || null,
    genres: show.genres || [],
    rating: show.rating ? show.rating.average : null,
    status: show.status || null,
    network: show.network ? show.network.name : show.webChannel ? show.webChannel.name : null,
    language: show.language || null,
    officialSite: show.officialSite || null,
    tvmazeUrl: show.url || null,
  };
}

async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    } else {
      return res;
    }
  }
}

async function handleMusicOrMovieSearch(q, type, limit, country) {
  const media = type === "music" ? "music" : "movie";
  const entity = type === "music" ? "song" : "movie";

  const itunesUrl = new URL(ITUNES_BASE);
  itunesUrl.searchParams.set("term", q);
  itunesUrl.searchParams.set("media", media);
  itunesUrl.searchParams.set("entity", entity);
  itunesUrl.searchParams.set("limit", limit);
  itunesUrl.searchParams.set("country", country);

  const res = await fetchWithRetry(itunesUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw { status: res.status, details: bodyText.slice(0, 300), source: "iTunes" };
  }

  const data = await res.json();
  const normalizer = type === "music" ? normalizeMusic : normalizeMovie;
  return (data.results || []).map(normalizer);
}

async function handleSeriesSearch(q, limit) {
  const tvUrl = new URL(TVMAZE_BASE);
  tvUrl.searchParams.set("q", q);

  const res = await fetchWithRetry(tvUrl.toString(), {
    headers: {
      "User-Agent": "GlassValleyMetadataWorker/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw { status: res.status, details: bodyText.slice(0, 300), source: "TVmaze" };
  }

  const data = await res.json();
  const limited = data.slice(0, parseInt(limit, 10) || 10);
  return limited.map(normalizeSeries);
}

async function handleSearch(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const type = url.searchParams.get("type");
  const limit = url.searchParams.get("limit") || "10";
  const country = url.searchParams.get("country") || "US";

  if (!q || !type) {
    return jsonResponse(
      { error: "Missing required params: q, type (music|movie|series)" },
      400
    );
  }

  if (!["music", "movie", "series"].includes(type)) {
    return jsonResponse(
      { error: `Invalid type '${type}'. Use one of: music, movie, series` },
      400
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    let results;
    if (type === "series") {
      results = await handleSeriesSearch(q, limit);
    } else {
      results = await handleMusicOrMovieSearch(q, type, limit, country);
    }

    const responseBody = { query: q, type, count: results.length, results };
    const response = jsonResponse(responseBody, 200);
    response.headers.set("Cache-Control", "public, max-age=21600");
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    return jsonResponse(
      {
        error: `Upstream ${err.source || "API"} error`,
        status: err.status || 500,
        details: err.details || String(err),
      },
      502
    );
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/search") {
      return handleSearch(request);
    }

    if (url.pathname === "/" || url.pathname === "") {
      return jsonResponse(
        {
          name: "Glass Valley Metadata Worker",
          usage: "/search?type=music|movie|series&q=<query>&limit=10&country=US",
          examples: [
            "/search?type=music&q=Kendrick+Lamar",
            "/search?type=movie&q=Inception",
            "/search?type=series&q=Breaking+Bad",
          ],
        },
        200
      );
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};
