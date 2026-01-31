import { sqliteDb } from "../db/index.js";
import { generateEmbedding, createEmbeddingText } from "../services/embeddings.js";

interface MovieRow {
  id: number;
  title: string;
  title_ja: string | null;
  overview: string | null;
  overview_ja: string | null;
  genres: string | null;
}

function serializeFloat32(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i]!, i * 4);
  }
  return buf;
}

async function generateEmbeddings() {
  console.log("Starting embedding generation...");

  // Get movies without embeddings (rowid in vec0 matches movie id)
  const existingEmbeddings = sqliteDb.prepare(`
    SELECT rowid FROM movie_embeddings
  `).all() as { rowid: number }[];

  const existingIds = new Set(existingEmbeddings.map(e => e.rowid));

  const allMovies = sqliteDb.prepare(`
    SELECT id, title, title_ja, overview, overview_ja, genres
    FROM movies
    ORDER BY id
  `).all() as MovieRow[];

  const movies = allMovies.filter(m => !existingIds.has(m.id));

  console.log(`Found ${movies.length} movies without embeddings`);

  if (movies.length === 0) {
    console.log("All movies already have embeddings!");
    sqliteDb.close();
    return;
  }

  let processed = 0;
  let failed = 0;

  for (const movie of movies) {
    try {
      const genres = movie.genres ? JSON.parse(movie.genres) as string[] : [];

      const text = createEmbeddingText(
        movie.title,
        movie.title_ja,
        movie.overview,
        movie.overview_ja,
        genres
      );

      const embedding = await generateEmbedding(text);

      // Serialize embedding to binary format for sqlite-vec
      const embeddingBlob = serializeFloat32(embedding);

      // Insert using raw SQL with blob binding
      sqliteDb.prepare(`
        INSERT INTO movie_embeddings (rowid, embedding)
        VALUES (?, ?)
      `).run(BigInt(movie.id), embeddingBlob);

      processed++;

      if (processed % 10 === 0) {
        console.log(`Progress: ${processed}/${movies.length} (${((processed / movies.length) * 100).toFixed(1)}%)`);
      }

      // Small delay to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`Failed to generate embedding for movie ${movie.id}:`, error);
      failed++;

      // If we hit too many failures, stop
      if (failed > 10) {
        console.error("Too many failures, stopping...");
        break;
      }
    }
  }

  console.log(`\nEmbedding generation complete!`);
  console.log(`Processed: ${processed}`);
  console.log(`Failed: ${failed}`);

  // Verify embeddings
  const embeddingCount = sqliteDb.prepare(
    "SELECT COUNT(*) as count FROM movie_embeddings"
  ).get() as { count: number };
  console.log(`\nMovies with embeddings: ${embeddingCount.count}`);

  sqliteDb.close();
}

generateEmbeddings().catch(console.error);
