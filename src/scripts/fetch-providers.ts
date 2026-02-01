import { sqliteDb } from "../db/index.js";
import { getWatchProviders, delay } from "../services/tmdb.js";

interface Movie {
  id: number;
  tmdb_id: number;
  title: string;
}

const REGIONS = ["JP", "US"];

async function fetchProviders() {
  console.log("Starting watch providers fetch from TMDb...");
  console.log(`Fetching from regions: ${REGIONS.join(", ")}`);

  // Get all movies from the database
  const movies = sqliteDb
    .prepare("SELECT id, tmdb_id, title FROM movies")
    .all() as Movie[];

  console.log(`Found ${movies.length} movies in database`);

  // Prepare insert statement with region
  const insertStmt = sqliteDb.prepare(`
    INSERT OR IGNORE INTO watch_providers (movie_id, provider_name, provider_type, logo_path, region)
    VALUES (?, ?, ?, ?, ?)
  `);

  let processed = 0;
  let withProviders = 0;
  let totalProviders = 0;

  for (const movie of movies) {
    let movieHasProviders = false;

    for (const region of REGIONS) {
      try {
        const providers = await getWatchProviders(movie.tmdb_id, region);

        if (providers) {
          // Insert flatrate (subscription) providers
          if (providers.flatrate) {
            for (const provider of providers.flatrate) {
              insertStmt.run(
                movie.id,
                provider.provider_name,
                "flatrate",
                provider.logo_path,
                region
              );
              totalProviders++;
            }
            movieHasProviders = true;
          }

          // Insert rent providers
          if (providers.rent) {
            for (const provider of providers.rent) {
              insertStmt.run(
                movie.id,
                provider.provider_name,
                "rent",
                provider.logo_path,
                region
              );
              totalProviders++;
            }
            movieHasProviders = true;
          }

          // Insert buy providers
          if (providers.buy) {
            for (const provider of providers.buy) {
              insertStmt.run(
                movie.id,
                provider.provider_name,
                "buy",
                provider.logo_path,
                region
              );
              totalProviders++;
            }
            movieHasProviders = true;
          }
        }

        // Rate limit: ~30 requests per second
        await delay(35);
      } catch (error) {
        console.error(`Error fetching providers for movie ${movie.tmdb_id} (${region}):`, error);
        await delay(1000);
      }
    }

    if (movieHasProviders) {
      withProviders++;
    }

    processed++;

    if (processed % 50 === 0) {
      console.log(
        `Progress: ${processed}/${movies.length} movies processed, ${withProviders} with providers`
      );
    }
  }

  console.log("\nFetch complete!");
  console.log(`Total movies processed: ${processed}`);
  console.log(`Movies with providers: ${withProviders}`);
  console.log(`Total provider entries: ${totalProviders}`);

  sqliteDb.close();
}

fetchProviders().catch(console.error);
