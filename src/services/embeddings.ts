import OpenAI from "openai";
import "dotenv/config";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY || OPENAI_API_KEY === "your_openai_api_key") {
  console.warn("Warning: OPENAI_API_KEY is not set. Embeddings generation will fail.");
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0]!.embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)}`);

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    for (const data of response.data) {
      embeddings.push(data.embedding);
    }

    // Rate limiting: wait a bit between batches
    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return embeddings;
}

export function createEmbeddingText(
  title: string,
  titleJa: string | null,
  overview: string | null,
  overviewJa: string | null,
  genres: string[]
): string {
  const titleText = titleJa || title;
  const overviewText = overviewJa || overview || "";
  const genreText = genres.join(" ");

  return `${titleText} ${overviewText} ${genreText}`.trim();
}

export { EMBEDDING_DIMENSIONS, BATCH_SIZE };
