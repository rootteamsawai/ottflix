import { readFileSync } from "fs";
import { sqliteDb } from "../db/index.js";

interface MovieData {
  tmdbId: number;
  title: string;
  titleJa: string | null;
  overview: string | null;
  overviewJa: string | null;
  genres: string[];
  releaseDate: string | null;
  runtime: number | null;
  popularity: number;
  voteAverage: number;
  posterPath: string | null;
}

function seedMovies() {
  console.log("Starting database seeding...");

  // Read movies from JSON file
  const moviesData = JSON.parse(
    readFileSync("data/movies.json", "utf-8")
  ) as MovieData[];

  console.log(`Found ${moviesData.length} movies to seed`);

  // Prepare upsert statement
  const upsert = sqliteDb.prepare(`
    INSERT INTO movies (
      tmdb_id, title, title_ja, overview, overview_ja,
      genres, release_date, runtime, popularity, vote_average, poster_path, updated_at
    ) VALUES (
      @tmdbId, @title, @titleJa, @overview, @overviewJa,
      @genres, @releaseDate, @runtime, @popularity, @voteAverage, @posterPath, datetime('now')
    )
    ON CONFLICT(tmdb_id) DO UPDATE SET
      title = excluded.title,
      title_ja = excluded.title_ja,
      overview = excluded.overview,
      overview_ja = excluded.overview_ja,
      genres = excluded.genres,
      release_date = excluded.release_date,
      runtime = excluded.runtime,
      popularity = excluded.popularity,
      vote_average = excluded.vote_average,
      poster_path = excluded.poster_path,
      updated_at = datetime('now')
  `);

  let inserted = 0;
  let failed = 0;

  // Use transaction for better performance
  const transaction = sqliteDb.transaction((movies: MovieData[]) => {
    for (const movie of movies) {
      try {
        upsert.run({
          tmdbId: movie.tmdbId,
          title: movie.title,
          titleJa: movie.titleJa,
          overview: movie.overview,
          overviewJa: movie.overviewJa,
          genres: JSON.stringify(movie.genres),
          releaseDate: movie.releaseDate,
          runtime: movie.runtime,
          popularity: movie.popularity,
          voteAverage: movie.voteAverage,
          posterPath: movie.posterPath,
        });
        inserted++;
      } catch (error) {
        console.error(`Failed to insert movie ${movie.tmdbId}:`, error);
        failed++;
      }
    }
  });

  transaction(moviesData);

  console.log(`\nSeeding complete!`);
  console.log(`Processed: ${inserted}`);
  console.log(`Failed: ${failed}`);

  // Verify count
  const countResult = sqliteDb.prepare("SELECT COUNT(*) as count FROM movies").get() as { count: number };
  console.log(`\nTotal movies in database: ${countResult.count}`);

  sqliteDb.close();
}

seedMovies();
