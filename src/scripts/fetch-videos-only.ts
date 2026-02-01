import "dotenv/config";
import { sqliteDb } from "../db/index.js";
import { delay } from "../services/tmdb.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN;

if (!TMDB_ACCESS_TOKEN) {
  throw new Error("TMDB_ACCESS_TOKEN environment variable is not set");
}

interface Movie {
  id: number;
  tmdb_id: number;
  title: string;
}

interface Video {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

interface VideosResponse {
  id: number;
  results: Video[];
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000;
      console.log(`Rate limited, waiting ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      continue;
    }

    if (!response.ok) {
      throw new Error(`TMDb API error: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  throw new Error("Max retries exceeded");
}

async function getMovieVideos(
  movieId: number,
  language: string
): Promise<VideosResponse> {
  const url = new URL(`${TMDB_BASE_URL}/movie/${movieId}/videos`);
  url.searchParams.set("language", language);

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}

async function fetchVideosOnly() {
  console.log("Fetching videos for movies without video data...\n");

  // Get movies that don't have any videos in movie_videos table
  const moviesWithoutVideos = sqliteDb.prepare(`
    SELECT m.id, m.tmdb_id, m.title
    FROM movies m
    LEFT JOIN movie_videos mv ON m.id = mv.movie_id
    WHERE mv.id IS NULL
  `).all() as Movie[];

  console.log(`Found ${moviesWithoutVideos.length} movies without videos\n`);

  if (moviesWithoutVideos.length === 0) {
    console.log("All movies already have video data!");
    sqliteDb.close();
    return;
  }

  const insertVideo = sqliteDb.prepare(`
    INSERT INTO movie_videos (movie_id, video_key, name, site, video_type, official, name_en, video_key_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(movie_id, video_key) DO UPDATE SET
      name_en = excluded.name_en,
      video_key_en = excluded.video_key_en
  `);

  let processed = 0;
  let moviesWithVideos = 0;
  let totalVideosAdded = 0;
  let errors = 0;

  const startTime = Date.now();

  for (const movie of moviesWithoutVideos) {
    try {
      // Fetch Japanese videos first
      const jaResponse = await getMovieVideos(movie.tmdb_id, "ja-JP");
      const jaVideos = (jaResponse.results || [])
        .filter((v) => v.site === "YouTube" && ["Trailer", "Teaser"].includes(v.type))
        .slice(0, 5);

      // Fetch English videos
      const enResponse = await getMovieVideos(movie.tmdb_id, "en-US");
      const enVideos = (enResponse.results || [])
        .filter((v) => v.site === "YouTube" && ["Trailer", "Teaser"].includes(v.type));

      // Create a map of English videos by type for matching
      const enVideoMap = new Map<string, { key: string; name: string }>();
      for (const v of enVideos) {
        if (!enVideoMap.has(v.type)) {
          enVideoMap.set(v.type, { key: v.key, name: v.name });
        }
      }

      // If no Japanese videos, use English videos as primary
      const primaryVideos = jaVideos.length > 0 ? jaVideos : enVideos.slice(0, 5);

      if (primaryVideos.length > 0) {
        moviesWithVideos++;
        totalVideosAdded += primaryVideos.length;

        for (const video of primaryVideos) {
          const enVideo = enVideoMap.get(video.type);
          const isEnglishPrimary = jaVideos.length === 0;
          insertVideo.run(
            movie.id,
            video.key,
            video.name,
            video.site,
            video.type,
            video.official ? 1 : 0,
            isEnglishPrimary ? null : (enVideo?.name || null),
            isEnglishPrimary ? null : (enVideo?.key || null)
          );
        }
      }

      processed++;

      // Progress display every 100 movies
      if (processed % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = moviesWithoutVideos.length - processed;
        const eta = remaining / rate;
        console.log(
          `Progress: ${processed}/${moviesWithoutVideos.length} ` +
          `(${((processed / moviesWithoutVideos.length) * 100).toFixed(1)}%) | ` +
          `Videos added: ${totalVideosAdded} | ` +
          `ETA: ${Math.ceil(eta / 60)} min`
        );
      }

      // Rate limiting: 2 API calls per movie, TMDb allows 40 requests/second
      await delay(100);
    } catch (error) {
      errors++;
      console.error(`Error processing movie ${movie.tmdb_id} (${movie.title}):`, error);
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log("\n========================================");
  console.log("Completed!");
  console.log("========================================");
  console.log(`Total movies processed: ${processed}`);
  console.log(`Movies with videos: ${moviesWithVideos}`);
  console.log(`Total videos added: ${totalVideosAdded}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time elapsed: ${Math.ceil(totalTime / 60)} minutes`);

  // Print final video count
  const videoCount = (sqliteDb.prepare(`SELECT COUNT(*) as count FROM movie_videos`).get() as { count: number }).count;
  console.log(`\nTotal videos in database: ${videoCount}`);

  sqliteDb.close();
}

fetchVideosOnly().catch(console.error);
