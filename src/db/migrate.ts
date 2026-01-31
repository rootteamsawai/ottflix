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

    console.log("Migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    sqliteDb.close();
  }
}

migrate();
