import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { sqliteDb } from "./db/index.js";
import { generateEmbedding } from "./services/embeddings.js";

const app = new Hono();

function serializeFloat32(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i]!, i * 4);
  }
  return buf;
}

// API: Get movies with pagination and search
app.get("/api/movies", (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");
  const search = c.req.query("search") || "";
  const genre = c.req.query("genre") || "";
  const offset = (page - 1) * limit;

  let whereClause = "1=1";
  const params: (string | number)[] = [];

  if (search) {
    whereClause += " AND (title LIKE ? OR title_ja LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  if (genre) {
    whereClause += " AND genres LIKE ?";
    params.push(`%${genre}%`);
  }

  const countStmt = sqliteDb.prepare(
    `SELECT COUNT(*) as count FROM movies WHERE ${whereClause}`
  );
  const { count } = countStmt.get(...params) as { count: number };

  const stmt = sqliteDb.prepare(`
    SELECT id, tmdb_id, title, title_ja, overview_ja, genres,
           release_date, runtime, popularity, vote_average, poster_path
    FROM movies
    WHERE ${whereClause}
    ORDER BY popularity DESC
    LIMIT ? OFFSET ?
  `);

  const movies = stmt.all(...params, limit, offset);

  return c.json({
    movies,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
    },
  });
});

// API: Get watch providers for a movie
app.get("/api/movies/:id/providers", (c) => {
  const id = c.req.param("id");

  const providers = sqliteDb.prepare(`
    SELECT provider_name, provider_type, logo_path
    FROM watch_providers
    WHERE movie_id = ?
  `).all(id) as { provider_name: string; provider_type: string; logo_path: string }[];

  // Group providers by type
  const result = {
    flatrate: providers.filter(p => p.provider_type === "flatrate"),
    rent: providers.filter(p => p.provider_type === "rent"),
    buy: providers.filter(p => p.provider_type === "buy"),
  };

  return c.json(result);
});

// API: Get genres
app.get("/api/genres", (c) => {
  const stmt = sqliteDb.prepare(`SELECT genres FROM movies WHERE genres IS NOT NULL`);
  const rows = stmt.all() as { genres: string }[];

  const genreSet = new Set<string>();
  for (const row of rows) {
    try {
      const genres = JSON.parse(row.genres) as string[];
      genres.forEach((g) => genreSet.add(g));
    } catch {
      // skip invalid JSON
    }
  }

  return c.json([...genreSet].sort());
});

// API: Semantic search using vector similarity
app.get("/api/search", async (c) => {
  const query = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");

  if (!query) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  try {
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);
    const queryBlob = serializeFloat32(queryEmbedding);

    // Find similar movies using vector search
    const results = sqliteDb.prepare(`
      SELECT
        m.id, m.tmdb_id, m.title, m.title_ja, m.overview_ja, m.genres,
        m.release_date, m.runtime, m.popularity, m.vote_average, m.poster_path,
        e.distance
      FROM movie_embeddings e
      JOIN movies m ON m.id = e.rowid
      WHERE e.embedding MATCH ? AND k = ?
      ORDER BY e.distance
    `).all(queryBlob, limit);

    return c.json({ movies: results, query });
  } catch (error) {
    console.error("Search error:", error);
    return c.json({ error: "Search failed" }, 500);
  }
});

// API: Get similar movies by movie ID (AI-based similarity)
app.get("/api/movies/:id/similar", (c) => {
  const id = parseInt(c.req.param("id"));
  const limit = parseInt(c.req.query("limit") || "10");

  // Get the embedding for the target movie
  const embedding = sqliteDb.prepare(`
    SELECT embedding FROM movie_embeddings WHERE rowid = ?
  `).get(id) as { embedding: Buffer } | undefined;

  if (!embedding) {
    return c.json({ error: "Movie embedding not found" }, 404);
  }

  // Find similar movies (fetch extra to filter out the source movie)
  const results = sqliteDb.prepare(`
    SELECT
      m.id, m.tmdb_id, m.title, m.title_ja, m.overview_ja, m.genres,
      m.release_date, m.runtime, m.vote_average, m.poster_path,
      e.distance
    FROM movie_embeddings e
    JOIN movies m ON m.id = e.rowid
    WHERE e.embedding MATCH ? AND k = ?
    ORDER BY e.distance
  `).all(embedding.embedding, limit + 1) as any[];

  // Filter out the source movie
  const filteredResults = results.filter((r: any) => r.id !== id).slice(0, limit);

  return c.json({ movies: filteredResults });
});

// API: Get movie credits (cast and crew)
app.get("/api/movies/:id/credits", (c) => {
  const id = c.req.param("id");

  // Check if movie exists
  const movie = sqliteDb.prepare(`SELECT id FROM movies WHERE id = ?`).get(id);
  if (!movie) {
    return c.json({ error: "Movie not found" }, 404);
  }

  // Get cast
  const cast = sqliteDb.prepare(`
    SELECT p.tmdb_id, p.name, p.profile_path, mc.character, mc.cast_order
    FROM movie_cast mc
    JOIN people p ON p.id = mc.person_id
    WHERE mc.movie_id = ?
    ORDER BY mc.cast_order
  `).all(id);

  // Get crew
  const crew = sqliteDb.prepare(`
    SELECT p.tmdb_id, p.name, p.profile_path, mc.department, mc.job
    FROM movie_crew mc
    JOIN people p ON p.id = mc.person_id
    WHERE mc.movie_id = ?
    ORDER BY mc.department, mc.job
  `).all(id);

  return c.json({ cast, crew });
});

// API: Get movie videos (trailers, teasers)
app.get("/api/movies/:id/videos", (c) => {
  const id = c.req.param("id");

  const videos = sqliteDb.prepare(`
    SELECT video_key, name, site, video_type, official
    FROM movie_videos
    WHERE movie_id = ?
    ORDER BY official DESC, video_type ASC
  `).all(id);

  return c.json({ videos });
});

// API: Get movie reviews
app.get("/api/movies/:id/reviews", (c) => {
  const id = c.req.param("id");

  const reviews = sqliteDb.prepare(`
    SELECT tmdb_review_id, author, content, rating, created_at
    FROM movie_reviews
    WHERE movie_id = ?
    ORDER BY created_at DESC
  `).all(id);

  return c.json({ reviews });
});

// API: Get TMDb similar movies (from TMDb recommendations)
app.get("/api/movies/:id/tmdb-similar", (c) => {
  const id = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "10");

  // Get similar TMDb IDs
  const similarTmdbIds = sqliteDb.prepare(`
    SELECT similar_tmdb_id, similarity_order
    FROM movie_similar
    WHERE movie_id = ?
    ORDER BY similarity_order
    LIMIT ?
  `).all(id, limit) as { similar_tmdb_id: number; similarity_order: number }[];

  // Get movie details for those that exist in our database
  const movies = [];
  for (const sim of similarTmdbIds) {
    const movie = sqliteDb.prepare(`
      SELECT id, tmdb_id, title, title_ja, poster_path, vote_average
      FROM movies
      WHERE tmdb_id = ?
    `).get(sim.similar_tmdb_id);

    if (movie) {
      movies.push(movie);
    }
  }

  return c.json({ movies });
});

// API: Get extended movie details
app.get("/api/movies/:id/extended", (c) => {
  const id = c.req.param("id");

  const extended = sqliteDb.prepare(`
    SELECT budget, revenue, tagline, tagline_ja, status, imdb_id, homepage,
           production_companies, production_countries, spoken_languages
    FROM movie_details_extended
    WHERE movie_id = ?
  `).get(id) as Record<string, unknown> | undefined;

  if (!extended) {
    return c.json({ error: "Extended details not found" }, 404);
  }

  // Parse JSON fields
  return c.json({
    ...extended,
    production_companies: JSON.parse((extended.production_companies as string) || "[]"),
    production_countries: JSON.parse((extended.production_countries as string) || "[]"),
    spoken_languages: JSON.parse((extended.spoken_languages as string) || "[]"),
  });
});

// API: Get full movie details (all data combined)
app.get("/api/movies/:id/full", async (c) => {
  const id = c.req.param("id");

  // Get basic movie info with watch providers
  const movie = sqliteDb.prepare(`SELECT * FROM movies WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!movie) {
    return c.json({ error: "Movie not found" }, 404);
  }

  // Get watch providers
  const providers = sqliteDb.prepare(`
    SELECT provider_name, provider_type, logo_path
    FROM watch_providers
    WHERE movie_id = ?
  `).all(id) as { provider_name: string; provider_type: string; logo_path: string }[];

  const watchProviders = {
    flatrate: providers.filter(p => p.provider_type === "flatrate"),
    rent: providers.filter(p => p.provider_type === "rent"),
    buy: providers.filter(p => p.provider_type === "buy"),
  };

  // Get credits
  const cast = sqliteDb.prepare(`
    SELECT p.tmdb_id, p.name, p.profile_path, mc.character, mc.cast_order
    FROM movie_cast mc
    JOIN people p ON p.id = mc.person_id
    WHERE mc.movie_id = ?
    ORDER BY mc.cast_order
  `).all(id);

  const crew = sqliteDb.prepare(`
    SELECT p.tmdb_id, p.name, p.profile_path, mc.department, mc.job
    FROM movie_crew mc
    JOIN people p ON p.id = mc.person_id
    WHERE mc.movie_id = ?
    ORDER BY mc.department, mc.job
  `).all(id);

  // Get videos
  const videos = sqliteDb.prepare(`
    SELECT video_key, name, site, video_type, official
    FROM movie_videos
    WHERE movie_id = ?
    ORDER BY official DESC, video_type ASC
  `).all(id);

  // Get reviews
  const reviews = sqliteDb.prepare(`
    SELECT tmdb_review_id, author, content, rating, created_at
    FROM movie_reviews
    WHERE movie_id = ?
    ORDER BY created_at DESC
  `).all(id);

  // Get TMDb similar movies
  const similarTmdbIds = sqliteDb.prepare(`
    SELECT similar_tmdb_id FROM movie_similar WHERE movie_id = ? ORDER BY similarity_order LIMIT 10
  `).all(id) as { similar_tmdb_id: number }[];

  const tmdbSimilar = [];
  for (const sim of similarTmdbIds) {
    const m = sqliteDb.prepare(`
      SELECT id, tmdb_id, title, title_ja, poster_path, vote_average FROM movies WHERE tmdb_id = ?
    `).get(sim.similar_tmdb_id);
    if (m) tmdbSimilar.push(m);
  }

  // Get extended details
  const extended = sqliteDb.prepare(`
    SELECT budget, revenue, tagline, tagline_ja, status, imdb_id, homepage,
           production_companies, production_countries, spoken_languages
    FROM movie_details_extended
    WHERE movie_id = ?
  `).get(id) as Record<string, unknown> | undefined;

  return c.json({
    ...movie,
    watchProviders,
    credits: { cast, crew },
    videos,
    reviews,
    tmdbSimilar,
    extended: extended ? {
      ...extended,
      production_companies: JSON.parse((extended.production_companies as string) || "[]"),
      production_countries: JSON.parse((extended.production_countries as string) || "[]"),
      spoken_languages: JSON.parse((extended.spoken_languages as string) || "[]"),
    } : null,
  });
});

// API: Get single movie with watch providers (must be after more specific :id/* routes)
app.get("/api/movies/:id", (c) => {
  const id = c.req.param("id");
  const stmt = sqliteDb.prepare(`
    SELECT * FROM movies WHERE id = ?
  `);
  const movie = stmt.get(id) as Record<string, unknown> | undefined;

  if (!movie) {
    return c.json({ error: "Movie not found" }, 404);
  }

  // Get watch providers for this movie
  const providers = sqliteDb.prepare(`
    SELECT provider_name, provider_type, logo_path
    FROM watch_providers
    WHERE movie_id = ?
  `).all(id) as { provider_name: string; provider_type: string; logo_path: string }[];

  // Group providers by type
  const watchProviders = {
    flatrate: providers.filter(p => p.provider_type === "flatrate"),
    rent: providers.filter(p => p.provider_type === "rent"),
    buy: providers.filter(p => p.provider_type === "buy"),
  };

  return c.json({ ...movie, watchProviders });
});

// Serve static files from public directory
app.use("/*", serveStatic({ root: "./public" }));

const port = parseInt(process.env.PORT || "3000");
console.log(`Server running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
