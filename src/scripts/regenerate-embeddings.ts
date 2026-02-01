import { sqliteDb } from "../db/index.js";
import { generateEmbedding } from "../services/embeddings.js";

interface MovieRow {
  id: number;
  title: string;
  title_ja: string | null;
  overview: string | null;
  overview_ja: string | null;
  genres: string | null;
  tagline: string | null;
  tagline_ja: string | null;
  cast_names: string | null;
  director_names: string | null;
}

function serializeFloat32(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i]!, i * 4);
  }
  return buf;
}

function createRichEmbeddingText(movie: MovieRow): string {
  const parts: string[] = [];

  // Title (prefer Japanese)
  const title = movie.title_ja || movie.title;
  parts.push(title);

  // Tagline (prefer Japanese)
  const tagline = movie.tagline_ja || movie.tagline;
  if (tagline) {
    parts.push(tagline);
  }

  // Overview (prefer Japanese)
  const overview = movie.overview_ja || movie.overview;
  if (overview) {
    parts.push(overview);
  }

  // Genres
  if (movie.genres) {
    try {
      const genres = JSON.parse(movie.genres) as string[];
      if (genres.length > 0) {
        parts.push("ジャンル: " + genres.join(", "));
      }
    } catch {}
  }

  // Cast (top actors)
  if (movie.cast_names) {
    parts.push("出演: " + movie.cast_names);
  }

  // Director
  if (movie.director_names) {
    parts.push("監督: " + movie.director_names);
  }

  return parts.join(" ").trim();
}

async function regenerateEmbeddings() {
  console.log("Regenerating embeddings with enriched data...\n");

  // Get existing embedding IDs
  const existingIds = new Set(
    (sqliteDb.prepare("SELECT rowid FROM movie_embeddings_rowids").all() as { rowid: number }[])
      .map(r => r.rowid)
  );
  console.log(`Found ${existingIds.size} existing embeddings\n`);

  // Get all movies with extended data
  const allMovies = sqliteDb.prepare(`
    SELECT
      m.id,
      m.title,
      m.title_ja,
      m.overview,
      m.overview_ja,
      m.genres,
      de.tagline,
      de.tagline_ja,
      (
        SELECT GROUP_CONCAT(p.name, ', ')
        FROM movie_cast mc
        JOIN people p ON mc.person_id = p.id
        WHERE mc.movie_id = m.id
        ORDER BY mc.cast_order
        LIMIT 5
      ) as cast_names,
      (
        SELECT GROUP_CONCAT(p.name, ', ')
        FROM movie_crew mc
        JOIN people p ON mc.person_id = p.id
        WHERE mc.movie_id = m.id AND mc.job = 'Director'
      ) as director_names
    FROM movies m
    LEFT JOIN movie_details_extended de ON m.id = de.movie_id
    ORDER BY m.id
  `).all() as MovieRow[];

  // Filter to only movies without embeddings
  const movies = allMovies.filter(m => !existingIds.has(m.id));
  console.log(`Found ${movies.length} movies without embeddings\n`);

  if (movies.length === 0) {
    console.log("All movies already have embeddings!");
    sqliteDb.close();
    return;
  }

  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const movie of movies) {
    try {
      const text = createRichEmbeddingText(movie);
      const embedding = await generateEmbedding(text);
      const embeddingBlob = serializeFloat32(embedding);

      sqliteDb.prepare(`
        INSERT INTO movie_embeddings (rowid, embedding)
        VALUES (?, ?)
      `).run(BigInt(movie.id), embeddingBlob);

      processed++;

      if (processed % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = movies.length - processed;
        const eta = remaining / rate;
        console.log(
          `Progress: ${processed}/${movies.length} (${((processed / movies.length) * 100).toFixed(1)}%) | ` +
          `ETA: ${Math.ceil(eta / 60)} min`
        );
      }

      // Rate limit: ~20 requests/second
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`Failed movie ${movie.id} (${movie.title}):`, error);
      failed++;

      if (failed > 20) {
        console.error("Too many failures, stopping...");
        break;
      }
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log("\n========================================");
  console.log("Embedding regeneration complete!");
  console.log("========================================");
  console.log(`Processed: ${processed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${Math.ceil(totalTime / 60)} minutes`);

  const count = (sqliteDb.prepare("SELECT COUNT(*) as count FROM movie_embeddings").get() as { count: number }).count;
  console.log(`\nTotal embeddings: ${count}`);

  sqliteDb.close();
}

regenerateEmbeddings().catch(console.error);
