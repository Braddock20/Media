/**
 * Glass Valley Metadata Worker
 * Unified music / movie / series metadata + previews
 * Source: iTunes Search API (no key required)
 */

const ITUNES_BASE = "https://itunes.apple.com/search";

const TYPE_MAP = {
  music: { media: "music", entity: "song" },
  movie: { media: "movie", entity: "movie" },
  series: { media: "tvShow", entity: "tvSeason" },
};

function normalize(item, type) {
  const base = {
    type,
    id: item.trackId || item.collectionId,
    title: item.trackName || item.collectionName,
    artwork: item.artworkUrl100
      ? item.artworkUrl100.replace("100x100", "600x600")
      : null,
    releaseDate: item.releaseDate || null,
    genre: item.primaryGenreName || null,
    previewUrl: item.previewUrl || null,
    storeUrl: item.trackViewUrl || item.collectionViewUrl || null,
  };

  if (type === "music") {
    base.artist = item.artistName || null;
    base.album = item.collectionName || null;
    base.trackTimeMillis = item.trackTimeMillis || null;
  } else if (type === "movie") {
    base.director = null; // iTunes doesn't expose director directly
    base.artist = item.artistName || null; // often studio/production credit
    base.longDescription = item.longDescription || item.shortDescription || null;
    base.rating = item.contentAdvisoryRating || null;
  } else if (type === "series") {
    base.showName = item.collectionName || item.artistName || null;
    base.artist = item.artistName || null;
    base.rating = item.contentAdvisoryRating || null;
  }

  return base;
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

  const mapping = TYPE_MAP[type];
  if (!mapping) {
    return jsonResponse(
      { error: `Invalid type '${type}'. Use one of: music, movie, series` },
      400
    );
  }

  // Cache check
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const itunesUrl = new URL(ITUNES_BASE);
  itunesUrl.searchParams.set("term", q);
  itunesUrl.searchParams.set("media", mapping.media);
  itunesUrl.searchParams.set("entity", mapping.entity);
  itunesUrl.searchParams.set("limit", limit);
  itunesUrl.searchParams.set("country", country);

  const res = await fetch(itunesUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return jsonResponse(
      {
        error: "Upstream iTunes API error",
        status: res.status,
        details: bodyText.slice(0, 300),
      },
      502
    );
  }

  const data = await res.json();
  const results = (data.results || []).map((item) => normalize(item, type));

  const responseBody = {
    query: q,
    type,
    count: results.length,
    results,
  };

  const response = jsonResponse(responseBody, 200);
  // Cache for 6 hours — metadata rarely changes
  response.headers.set("Cache-Control", "public, max-age=21600");
  await cache.put(cacheKey, response.clone());

  return response;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
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
    base.rating = item.contentAdvisoryRating || null;
  } else if (type === "series") {
    base.showName = item.collectionName || item.artistName || null;
    base.artist = item.artistName || null;
    base.rating = item.contentAdvisoryRating || null;
  }

  return base;
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

  const mapping = TYPE_MAP[type];
  if (!mapping) {
    return jsonResponse(
      { error: `Invalid type '${type}'. Use one of: music, movie, series` },
      400
    );
  }

  // Cache check
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const itunesUrl = new URL(ITUNES_BASE);
  itunesUrl.searchParams.set("term", q);
  itunesUrl.searchParams.set("media", mapping.media);
  itunesUrl.searchParams.set("entity", mapping.entity);
  itunesUrl.searchParams.set("limit", limit);
  itunesUrl.searchParams.set("country", country);

  const res = await fetch(itunesUrl.toString());
  if (!res.ok) {
    return jsonResponse({ error: "Upstream iTunes API error" }, 502);
  }

  const data = await res.json();
  const results = (data.results || []).map((item) => normalize(item, type));

  const responseBody = {
    query: q,
    type,
    count: results.length,
    results,
  };

  const response = jsonResponse(responseBody, 200);
  // Cache for 6 hours — metadata rarely changes
  response.headers.set("Cache-Control", "public, max-age=21600");
  await cache.put(cacheKey, response.clone());

  return response;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
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
