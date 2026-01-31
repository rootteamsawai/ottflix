import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { sqliteDb } from "./db/index.js";
import { generateEmbedding, calculateUserPreferenceEmbedding } from "./services/embeddings.js";
import {
  parseNetflixCsv,
  deduplicateEntries,
  fuzzyMatchTitle,
  type Movie,
} from "./services/personalization.js";
import { generateChatResponse, type ChatMessage } from "./services/chat.js";
import {
  getUserFromToken,
  getUserById,
  type User,
} from "./services/auth.js";
import {
  getOrCreateOnboardingSession,
  processOnboardingChat,
  completeOnboarding,
  getOnboardingHistory,
} from "./services/onboarding.js";
import {
  trackInteraction,
  getUserInteractions,
  getInteractionStats,
  updateUserEmbeddingFromBehavior,
  shouldUpdateEmbedding,
  type InteractionType,
} from "./services/learning.js";

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
    SELECT id, tmdb_id, title, title_ja, overview, overview_ja, genres,
           release_date, runtime, popularity, vote_average, poster_path, poster_path_en
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

// API: Semantic search using vector similarity (with optional personalization)
app.get("/api/search", async (c) => {
  const query = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");

  if (!query) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  try {
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);

    // Check if user is authenticated and has preference embedding
    const user = await getUserFromToken(c.req.header("Authorization"));
    let searchEmbedding: number[];

    if (user && user.preference_embedding) {
      // Combine query embedding with user preference embedding
      // Query: 70%, User preference: 30%
      const QUERY_WEIGHT = 0.7;
      const USER_WEIGHT = 0.3;

      const userEmbedding: number[] = [];
      for (let i = 0; i < queryEmbedding.length; i++) {
        userEmbedding.push(user.preference_embedding.readFloatLE(i * 4));
      }

      searchEmbedding = queryEmbedding.map((qVal, i) =>
        qVal * QUERY_WEIGHT + userEmbedding[i]! * USER_WEIGHT
      );

      // Normalize the combined embedding
      let magnitude = 0;
      for (const val of searchEmbedding) {
        magnitude += val * val;
      }
      magnitude = Math.sqrt(magnitude);
      if (magnitude > 0) {
        searchEmbedding = searchEmbedding.map((val) => val / magnitude);
      }
    } else {
      searchEmbedding = queryEmbedding;
    }

    const searchBlob = serializeFloat32(searchEmbedding);

    // Find similar movies using vector search
    const results = sqliteDb.prepare(`
      SELECT
        m.id, m.tmdb_id, m.title, m.title_ja, m.overview, m.overview_ja, m.genres,
        m.release_date, m.runtime, m.popularity, m.vote_average, m.poster_path, m.poster_path_en,
        e.distance
      FROM movie_embeddings e
      JOIN movies m ON m.id = e.rowid
      WHERE e.embedding MATCH ? AND k = ?
      ORDER BY e.distance
    `).all(searchBlob, limit);

    // Track search interaction if user is authenticated
    if (user) {
      trackInteraction(user.id, "search", undefined, query);
    }

    return c.json({
      movies: results,
      query,
      personalized: !!(user && user.preference_embedding),
    });
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
      m.id, m.tmdb_id, m.title, m.title_ja, m.overview, m.overview_ja, m.genres,
      m.release_date, m.runtime, m.vote_average, m.poster_path, m.poster_path_en,
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
    SELECT p.tmdb_id, p.name, p.name_en, p.profile_path, mc.character, mc.cast_order
    FROM movie_cast mc
    JOIN people p ON p.id = mc.person_id
    WHERE mc.movie_id = ?
    ORDER BY mc.cast_order
  `).all(id);

  // Get crew
  const crew = sqliteDb.prepare(`
    SELECT p.tmdb_id, p.name, p.name_en, p.profile_path, mc.department, mc.job
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
    SELECT video_key, video_key_en, name, name_en, site, video_type, official
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
      SELECT id, tmdb_id, title, title_ja, overview, overview_ja, poster_path, poster_path_en, vote_average
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
    SELECT p.tmdb_id, p.name, p.name_en, p.profile_path, mc.character, mc.cast_order
    FROM movie_cast mc
    JOIN people p ON p.id = mc.person_id
    WHERE mc.movie_id = ?
    ORDER BY mc.cast_order
  `).all(id);

  const crew = sqliteDb.prepare(`
    SELECT p.tmdb_id, p.name, p.name_en, p.profile_path, mc.department, mc.job
    FROM movie_crew mc
    JOIN people p ON p.id = mc.person_id
    WHERE mc.movie_id = ?
    ORDER BY mc.department, mc.job
  `).all(id);

  // Get videos
  const videos = sqliteDb.prepare(`
    SELECT video_key, video_key_en, name, name_en, site, video_type, official
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
      SELECT id, tmdb_id, title, title_ja, poster_path, poster_path_en, vote_average FROM movies WHERE tmdb_id = ?
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

// ============================================
// Personalization API Endpoints
// ============================================

// POST /api/history/upload - Upload Netflix CSV and process history
app.post("/api/history/upload", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"] as File | undefined;
    const sessionId = body["sessionId"] as string | undefined;

    if (!file || !sessionId) {
      return c.json({ error: "Missing file or sessionId" }, 400);
    }

    const csvContent = await file.text();
    const entries = parseNetflixCsv(csvContent);
    const dedupedEntries = deduplicateEntries(entries);

    // Get all movies for matching
    const allMovies = sqliteDb
      .prepare(`SELECT id, tmdb_id, title, title_ja, poster_path, poster_path_en, vote_average, genres FROM movies`)
      .all() as Movie[];

    // Clear existing history for this session
    sqliteDb.prepare(`DELETE FROM user_watch_history WHERE session_id = ?`).run(sessionId);
    sqliteDb.prepare(`DELETE FROM user_preferences WHERE session_id = ?`).run(sessionId);

    // Insert history and track matched movies
    const insertStmt = sqliteDb.prepare(`
      INSERT INTO user_watch_history (session_id, movie_id, netflix_title, watch_date, matched)
      VALUES (?, ?, ?, ?, ?)
    `);

    const matchedMovieIds: number[] = [];
    let matchedCount = 0;

    for (const entry of dedupedEntries) {
      const matchedMovie = fuzzyMatchTitle(entry.title, allMovies);
      const movieId = matchedMovie?.id || null;
      const matched = matchedMovie ? 1 : 0;

      insertStmt.run(sessionId, movieId, entry.title, entry.date, matched);

      if (matchedMovie) {
        matchedCount++;
        if (!matchedMovieIds.includes(matchedMovie.id)) {
          matchedMovieIds.push(matchedMovie.id);
        }
      }
    }

    // Calculate preference embedding from matched movies
    if (matchedMovieIds.length > 0) {
      const embeddings = sqliteDb
        .prepare(
          `SELECT embedding FROM movie_embeddings WHERE rowid IN (${matchedMovieIds.join(",")})`
        )
        .all() as { embedding: Buffer }[];

      if (embeddings.length > 0) {
        const preferenceEmbedding = calculateUserPreferenceEmbedding(
          embeddings.map((e) => e.embedding)
        );

        sqliteDb
          .prepare(
            `INSERT OR REPLACE INTO user_preferences (session_id, preference_embedding, movie_count, updated_at)
             VALUES (?, ?, ?, datetime('now'))`
          )
          .run(sessionId, preferenceEmbedding, matchedMovieIds.length);
      }
    }

    return c.json({
      success: true,
      totalEntries: dedupedEntries.length,
      matchedCount,
      matchedMovieIds: matchedMovieIds.length,
    });
  } catch (error) {
    console.error("History upload error:", error);
    return c.json({ error: "Failed to process history" }, 500);
  }
});

// GET /api/history/:sessionId - Get watch history for a session
app.get("/api/history/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");

  const history = sqliteDb
    .prepare(
      `SELECT h.id, h.netflix_title, h.watch_date, h.matched, h.movie_id,
              m.title, m.title_ja, m.poster_path, m.poster_path_en
       FROM user_watch_history h
       LEFT JOIN movies m ON m.id = h.movie_id
       WHERE h.session_id = ?
       ORDER BY h.id DESC`
    )
    .all(sessionId);

  const stats = sqliteDb
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN matched = 1 THEN 1 ELSE 0 END) as matched
       FROM user_watch_history WHERE session_id = ?`
    )
    .get(sessionId) as { total: number; matched: number };

  return c.json({ history, stats });
});

// DELETE /api/history/:sessionId - Clear history for a session
app.delete("/api/history/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");

  sqliteDb.prepare(`DELETE FROM user_watch_history WHERE session_id = ?`).run(sessionId);
  sqliteDb.prepare(`DELETE FROM user_preferences WHERE session_id = ?`).run(sessionId);

  return c.json({ success: true });
});

// GET /api/recommendations/:sessionId - Get personalized recommendations
app.get("/api/recommendations/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const limit = parseInt(c.req.query("limit") || "20");

  // 1. Get user preference embedding
  const pref = sqliteDb
    .prepare(`SELECT preference_embedding, movie_count FROM user_preferences WHERE session_id = ?`)
    .get(sessionId) as { preference_embedding: Buffer; movie_count: number } | undefined;

  if (!pref || !pref.preference_embedding) {
    return c.json({ error: "No history found" }, 404);
  }

  // 2. Get watched movie IDs to exclude
  const watchedIds = sqliteDb
    .prepare(
      `SELECT movie_id FROM user_watch_history
       WHERE session_id = ? AND movie_id IS NOT NULL`
    )
    .all(sessionId)
    .map((r: any) => r.movie_id);

  // 3. Find similar movies using preference embedding (fetch extra to filter)
  const candidates = sqliteDb
    .prepare(
      `SELECT m.id, m.tmdb_id, m.title, m.title_ja, m.poster_path, m.poster_path_en,
              m.vote_average, m.genres, e.distance
       FROM movie_embeddings e
       JOIN movies m ON m.id = e.rowid
       WHERE e.embedding MATCH ? AND k = ?
       ORDER BY e.distance`
    )
    .all(pref.preference_embedding, limit + watchedIds.length + 20) as any[];

  // 4. Filter out watched movies and limit results
  const recommendations = candidates
    .filter((m) => !watchedIds.includes(m.id))
    .slice(0, limit)
    .map((m) => ({
      ...m,
      affinity: Math.round((1 - m.distance) * 100), // Affinity percentage
    }));

  return c.json({
    recommendations,
    movieCount: pref.movie_count,
  });
});

// ============================================
// Chat API Endpoint (Akinator-style movie diagnosis)
// ============================================

app.post("/api/chat", async (c) => {
  try {
    const { messages } = await c.req.json<{ messages: ChatMessage[] }>();

    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: "messages is required" }, 400);
    }

    const response = await generateChatResponse(messages);
    return c.json(response);
  } catch (error) {
    console.error("Chat error:", error);
    return c.json({ error: "Chat failed" }, 500);
  }
});

// ============================================
// Authentication API Endpoints (Supabase)
// ============================================

// GET /api/auth/me - Get current user (validates Supabase token)
app.get("/api/auth/me", async (c) => {
  const user = await getUserFromToken(c.req.header("Authorization"));

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    onboarding_completed: user.onboarding_completed === 1,
    has_preference: user.preference_embedding !== null,
  });
});

// POST /api/auth/logout - Logout (client-side token removal)
app.post("/api/auth/logout", (c) => {
  // Supabase handles token invalidation
  // Client should call supabase.auth.signOut()
  return c.json({ success: true });
});

// ============================================
// Onboarding API Endpoints
// ============================================

// GET /api/onboarding - Get onboarding session
app.get("/api/onboarding", async (c) => {
  const user = await getUserFromToken(c.req.header("Authorization"));

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  try {
    const messages = await getOrCreateOnboardingSession(user.id);
    return c.json({
      messages,
      isComplete: user.onboarding_completed === 1,
    });
  } catch (error) {
    console.error("Onboarding error:", error);
    return c.json({ error: "Failed to get onboarding session" }, 500);
  }
});

// POST /api/onboarding/chat - Process onboarding chat
app.post("/api/onboarding/chat", async (c) => {
  const user = await getUserFromToken(c.req.header("Authorization"));

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  try {
    const { message } = await c.req.json<{ message: string }>();

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    const result = await processOnboardingChat(user.id, message);
    return c.json(result);
  } catch (error) {
    console.error("Onboarding chat error:", error);
    return c.json({ error: "Failed to process chat" }, 500);
  }
});

// POST /api/onboarding/complete - Complete onboarding and generate embedding
app.post("/api/onboarding/complete", async (c) => {
  const user = await getUserFromToken(c.req.header("Authorization"));

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  try {
    await completeOnboarding(user.id);
    return c.json({ success: true });
  } catch (error) {
    console.error("Onboarding complete error:", error);
    return c.json({ error: "Failed to complete onboarding" }, 500);
  }
});

// ============================================
// User Interaction Tracking API Endpoints
// ============================================

// POST /api/interactions - Track user interaction
app.post("/api/interactions", async (c) => {
  const user = await getUserFromToken(c.req.header("Authorization"));

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  try {
    const { type, movieId, queryText } = await c.req.json<{
      type: InteractionType;
      movieId?: number;
      queryText?: string;
    }>();

    if (!type) {
      return c.json({ error: "Interaction type is required" }, 400);
    }

    const validTypes: InteractionType[] = ["search", "view", "favorite", "click"];
    if (!validTypes.includes(type)) {
      return c.json({ error: "Invalid interaction type" }, 400);
    }

    trackInteraction(user.id, type, movieId, queryText);

    // Check if we should update the embedding
    if (shouldUpdateEmbedding(user.id)) {
      // Update embedding asynchronously
      updateUserEmbeddingFromBehavior(user.id).catch((err) => {
        console.error("Failed to update embedding from behavior:", err);
      });
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Track interaction error:", error);
    return c.json({ error: "Failed to track interaction" }, 500);
  }
});

// GET /api/interactions/stats - Get user interaction statistics
app.get("/api/interactions/stats", async (c) => {
  const user = await getUserFromToken(c.req.header("Authorization"));

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  try {
    const stats = getInteractionStats(user.id);
    return c.json(stats);
  } catch (error) {
    console.error("Get stats error:", error);
    return c.json({ error: "Failed to get statistics" }, 500);
  }
});

// POST /api/interactions/update-embedding - Manually trigger embedding update
app.post("/api/interactions/update-embedding", async (c) => {
  const user = await getUserFromToken(c.req.header("Authorization"));

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  try {
    const updated = await updateUserEmbeddingFromBehavior(user.id);
    return c.json({ success: true, updated });
  } catch (error) {
    console.error("Update embedding error:", error);
    return c.json({ error: "Failed to update embedding" }, 500);
  }
});

// ============================================
// Config Endpoint (for frontend Supabase init)
// ============================================

app.get("/api/config", (c) => {
  return c.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
});

// Serve static files from public directory
app.use("/*", serveStatic({ root: "./public" }));

const port = parseInt(process.env.PORT || "3000");
console.log(`Server running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
