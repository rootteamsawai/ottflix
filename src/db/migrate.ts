import { mkdirSync, existsSync } from "fs";
import { sqliteDb } from "./index.js";

function migrate() {
  console.log("Running migrations...");

  try {
    // Ensure data directory exists
    if (!existsSync("data")) {
      mkdirSync("data", { recursive: true });
    }

    // Create movies table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdb_id INTEGER UNIQUE NOT NULL,
        title TEXT NOT NULL,
        title_ja TEXT,
        overview TEXT,
        overview_ja TEXT,
        genres TEXT,
        release_date TEXT,
        runtime INTEGER,
        popularity REAL,
        vote_average REAL,
        poster_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("Movies table created");

    // Create virtual table for vector search using sqlite-vec
    sqliteDb.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS movie_embeddings USING vec0(
        embedding float[1536]
      )
    `);
    console.log("Vector embeddings table created");

    // Create index on tmdb_id
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_movies_tmdb_id ON movies(tmdb_id)
    `);
    console.log("Index created");

    // Create watch_providers table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS watch_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL REFERENCES movies(id),
        provider_name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        logo_path TEXT,
        UNIQUE(movie_id, provider_name, provider_type)
      )
    `);
    console.log("Watch providers table created");

    // Create index on movie_id for faster lookups
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_watch_providers_movie_id ON watch_providers(movie_id)
    `);
    console.log("Watch providers index created");

    // Create people table (actors, directors, crew)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdb_id INTEGER UNIQUE NOT NULL,
        name TEXT NOT NULL,
        profile_path TEXT
      )
    `);
    console.log("People table created");

    // Create movie_cast table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS movie_cast (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL REFERENCES movies(id),
        person_id INTEGER NOT NULL REFERENCES people(id),
        character TEXT,
        cast_order INTEGER,
        UNIQUE(movie_id, person_id, character)
      )
    `);
    console.log("Movie cast table created");

    // Create movie_crew table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS movie_crew (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL REFERENCES movies(id),
        person_id INTEGER NOT NULL REFERENCES people(id),
        department TEXT,
        job TEXT NOT NULL,
        UNIQUE(movie_id, person_id, job)
      )
    `);
    console.log("Movie crew table created");

    // Create movie_videos table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS movie_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL REFERENCES movies(id),
        video_key TEXT NOT NULL,
        name TEXT,
        site TEXT DEFAULT 'YouTube',
        video_type TEXT NOT NULL,
        official INTEGER DEFAULT 1,
        UNIQUE(movie_id, video_key)
      )
    `);
    console.log("Movie videos table created");

    // Create movie_reviews table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS movie_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL REFERENCES movies(id),
        tmdb_review_id TEXT UNIQUE,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        rating REAL,
        created_at TEXT
      )
    `);
    console.log("Movie reviews table created");

    // Create movie_similar table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS movie_similar (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL REFERENCES movies(id),
        similar_tmdb_id INTEGER NOT NULL,
        similarity_order INTEGER,
        UNIQUE(movie_id, similar_tmdb_id)
      )
    `);
    console.log("Movie similar table created");

    // Create movie_details_extended table
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS movie_details_extended (
        movie_id INTEGER PRIMARY KEY REFERENCES movies(id),
        budget INTEGER,
        revenue INTEGER,
        tagline TEXT,
        tagline_ja TEXT,
        status TEXT,
        imdb_id TEXT,
        homepage TEXT,
        production_companies TEXT,
        production_countries TEXT,
        spoken_languages TEXT
      )
    `);
    console.log("Movie details extended table created");

    // Create indexes for new tables
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_people_tmdb_id ON people(tmdb_id);
      CREATE INDEX IF NOT EXISTS idx_movie_cast_movie_id ON movie_cast(movie_id);
      CREATE INDEX IF NOT EXISTS idx_movie_cast_person_id ON movie_cast(person_id);
      CREATE INDEX IF NOT EXISTS idx_movie_crew_movie_id ON movie_crew(movie_id);
      CREATE INDEX IF NOT EXISTS idx_movie_crew_person_id ON movie_crew(person_id);
      CREATE INDEX IF NOT EXISTS idx_movie_videos_movie_id ON movie_videos(movie_id);
      CREATE INDEX IF NOT EXISTS idx_movie_reviews_movie_id ON movie_reviews(movie_id);
      CREATE INDEX IF NOT EXISTS idx_movie_similar_movie_id ON movie_similar(movie_id);
    `);
    console.log("Indexes for new tables created");

    // Add English columns to movie_videos table for multilingual support
    try {
      sqliteDb.exec(`ALTER TABLE movie_videos ADD COLUMN name_en TEXT`);
      console.log("Added name_en column to movie_videos");
    } catch (e: any) {
      if (!e.message.includes("duplicate column")) throw e;
    }
    try {
      sqliteDb.exec(`ALTER TABLE movie_videos ADD COLUMN video_key_en TEXT`);
      console.log("Added video_key_en column to movie_videos");
    } catch (e: any) {
      if (!e.message.includes("duplicate column")) throw e;
    }

    // Add English name column to people table for multilingual support
    try {
      sqliteDb.exec(`ALTER TABLE people ADD COLUMN name_en TEXT`);
      console.log("Added name_en column to people");
    } catch (e: any) {
      if (!e.message.includes("duplicate column")) throw e;
    }

    // Add English poster path column to movies table for multilingual support
    try {
      sqliteDb.exec(`ALTER TABLE movies ADD COLUMN poster_path_en TEXT`);
      console.log("Added poster_path_en column to movies");
    } catch (e: any) {
      if (!e.message.includes("duplicate column")) throw e;
    }

    // Create user_watch_history table for Netflix history
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS user_watch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        movie_id INTEGER REFERENCES movies(id),
        netflix_title TEXT NOT NULL,
        watch_date TEXT,
        matched INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("User watch history table created");

    // Create index on session_id for faster lookups
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_watch_history_session ON user_watch_history(session_id)
    `);
    console.log("User watch history index created");

    // Create user_preferences table for storing preference embeddings
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        session_id TEXT PRIMARY KEY,
        preference_embedding BLOB,
        movie_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("User preferences table created");

    // Create users table for Supabase authentication
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supabase_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        picture TEXT,
        preference_embedding BLOB,
        onboarding_completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("Users table created");

    // Migration: rename google_id to supabase_id if needed
    try {
      // Check if google_id column exists and rename it
      const tableInfo = sqliteDb.prepare("PRAGMA table_info(users)").all() as any[];
      const hasGoogleId = tableInfo.some(col => col.name === 'google_id');
      const hasSupabaseId = tableInfo.some(col => col.name === 'supabase_id');

      if (hasGoogleId && !hasSupabaseId) {
        sqliteDb.exec(`ALTER TABLE users RENAME COLUMN google_id TO supabase_id`);
        console.log("Renamed google_id to supabase_id");
      }
    } catch (e: any) {
      console.log("Column migration check:", e.message);
    }

    // Create indexes for users table
    try {
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_id)`);
    } catch (e: any) {
      // Index might reference non-existent column or already exist
      try {
        sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
      } catch {}
    }
    sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    console.log("Users indexes created");

    // Create user_interactions table for behavior tracking
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS user_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        movie_id INTEGER REFERENCES movies(id),
        interaction_type TEXT NOT NULL,
        query_text TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("User interactions table created");

    // Create indexes for user_interactions table
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_interactions_movie_id ON user_interactions(movie_id);
      CREATE INDEX IF NOT EXISTS idx_user_interactions_type ON user_interactions(interaction_type);
    `);
    console.log("User interactions indexes created");

    // Create user_onboarding table for conversation history
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS user_onboarding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        messages TEXT NOT NULL,
        embedding_generated INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("User onboarding table created");

    // Create index for user_onboarding table
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_onboarding_user_id ON user_onboarding(user_id);
    `);
    console.log("User onboarding index created");

    console.log("Migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    sqliteDb.close();
  }
}

migrate();
