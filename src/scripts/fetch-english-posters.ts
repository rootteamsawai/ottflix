import "dotenv/config";
import { sqliteDb } from "../db/index.js";
import { delay } from "../services/tmdb.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN;

interface Movie {
  id: number;
  tmdb_id: number;
  title: string;
}

async function fetchEnglishPosters() {
  console.log("Fetching English poster paths for all movies...");

  // Get all movies from database
  const movies = sqliteDb.prepare(`SELECT id, tmdb_id, title FROM movies`).all() as Movie[];
  console.log(`Found ${movies.length} movies to process`);

  const updatePoster = sqliteDb.prepare(`
    UPDATE movies SET poster_path_en = ? WHERE id = ?
  `);

  let processed = 0;
  let updated = 0;
  let errors = 0;

  for (const movie of movies) {
    try {
      // Fetch movie details in English
      const url = new URL(`${TMDB_BASE_URL}/movie/${movie.tmdb_id}`);
      url.searchParams.set("language", "en-US");

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.poster_path) {
        updatePoster.run(data.poster_path, movie.id);
        updated++;
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`Processed ${processed}/${movies.length} movies (${updated} updated)`);
      }

      // Rate limiting
      await delay(50);
    } catch (error) {
      errors++;
      console.error(`Error processing movie ${movie.tmdb_id} (${movie.title}):`, error);
    }
  }

  console.log(`\nCompleted! Processed: ${processed}, Updated: ${updated}, Errors: ${errors}`);

  // Verify
  const stats = sqliteDb.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN poster_path_en IS NOT NULL THEN 1 ELSE 0 END) as with_english
    FROM movies
  `).get() as { total: number; with_english: number };

  console.log(`Movies with English posters: ${stats.with_english}/${stats.total}`);

  sqliteDb.close();
}

fetchEnglishPosters().catch(console.error);
