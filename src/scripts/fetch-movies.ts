import { writeFileSync, mkdirSync, existsSync } from "fs";
import { discoverMovies, getMovieDetails, genreIdsToNames, delay } from "../services/tmdb.js";

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

async function fetchMovies() {
  console.log("Starting movie fetch from TMDb...");

  const movies: MovieData[] = [];
  const targetCount = 5000;
  const moviesPerPage = 20;
  const totalPages = Math.ceil(targetCount / moviesPerPage);

  // Fetch discover list in Japanese first
  for (let page = 1; page <= totalPages && movies.length < targetCount; page++) {
    console.log(`Fetching page ${page}/${totalPages}...`);

    try {
      // Fetch Japanese version
      const jaResponse = await discoverMovies(page, "ja-JP");

      // Fetch English version for fallback
      const enResponse = await discoverMovies(page, "en-US");

      // Create a map of English data for fallback
      const enMovieMap = new Map(
        enResponse.results.map((m) => [m.id, m])
      );

      for (const movie of jaResponse.results) {
        if (movies.length >= targetCount) break;

        const enMovie = enMovieMap.get(movie.id);

        // Get movie details for runtime
        let runtime: number | null = null;
        try {
          const details = await getMovieDetails(movie.id, "ja-JP");
          runtime = details.runtime;
          await delay(30); // Rate limit: ~33 requests per second
        } catch (error) {
          console.warn(`Failed to get details for movie ${movie.id}:`, error);
        }

        const movieData: MovieData = {
          tmdbId: movie.id,
          title: enMovie?.title || movie.original_title,
          titleJa: movie.title !== movie.original_title ? movie.title : null,
          overview: enMovie?.overview || null,
          overviewJa: movie.overview || null,
          genres: genreIdsToNames(movie.genre_ids),
          releaseDate: movie.release_date || null,
          runtime,
          popularity: movie.popularity,
          voteAverage: movie.vote_average,
          posterPath: movie.poster_path,
        };

        movies.push(movieData);
      }

      // Rate limit between pages
      await delay(100);
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      // Wait longer on error
      await delay(1000);
    }

    console.log(`Progress: ${movies.length}/${targetCount} movies`);
  }

  // Ensure data directory exists
  const dataDir = "data";
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Save to JSON file
  const outputPath = `${dataDir}/movies.json`;
  writeFileSync(outputPath, JSON.stringify(movies, null, 2));

  console.log(`\nFetch complete!`);
  console.log(`Total movies: ${movies.length}`);
  console.log(`Saved to: ${outputPath}`);
}

fetchMovies().catch(console.error);
