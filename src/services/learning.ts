import { sqliteDb } from "../db/index.js";
import { updateUserEmbedding, getUserById } from "./auth.js";

export type InteractionType = "search" | "view" | "favorite" | "click";

interface UserInteraction {
  id: number;
  user_id: number;
  movie_id: number | null;
  interaction_type: InteractionType;
  query_text: string | null;
  created_at: string;
}

const EMBEDDING_DIMENSIONS = 1536;

// Weights for different interaction types
const INTERACTION_WEIGHTS: Record<InteractionType, number> = {
  favorite: 1.0,
  view: 0.6,
  click: 0.3,
  search: 0.2,
};

// Weight for combining new behavior with existing embedding
const NEW_BEHAVIOR_WEIGHT = 0.2;
const EXISTING_EMBEDDING_WEIGHT = 0.8;

// Time decay factor (interactions older than 30 days get reduced weight)
const TIME_DECAY_DAYS = 30;

export function trackInteraction(
  userId: number,
  interactionType: InteractionType,
  movieId?: number,
  queryText?: string
): void {
  sqliteDb.prepare(`
    INSERT INTO user_interactions (user_id, movie_id, interaction_type, query_text)
    VALUES (?, ?, ?, ?)
  `).run(userId, movieId || null, interactionType, queryText || null);
}

export function getUserInteractions(
  userId: number,
  limit: number = 100
): UserInteraction[] {
  return sqliteDb.prepare(`
    SELECT * FROM user_interactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as UserInteraction[];
}

function calculateTimeDecay(createdAt: string): number {
  const interactionDate = new Date(createdAt);
  const now = new Date();
  const daysDiff = (now.getTime() - interactionDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff <= TIME_DECAY_DAYS) {
    return 1.0;
  }

  // Exponential decay for older interactions
  return Math.exp(-(daysDiff - TIME_DECAY_DAYS) / TIME_DECAY_DAYS);
}

function bufferToFloatArray(buffer: Buffer): Float32Array {
  const arr = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    arr[i] = buffer.readFloatLE(i * 4);
  }
  return arr;
}

function floatArrayToBuffer(arr: Float32Array): Buffer {
  const buffer = Buffer.alloc(EMBEDDING_DIMENSIONS * 4);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    buffer.writeFloatLE(arr[i]!, i * 4);
  }
  return buffer;
}

export async function updateUserEmbeddingFromBehavior(userId: number): Promise<boolean> {
  const user = getUserById(userId);
  if (!user) {
    return false;
  }

  // Get recent interactions with movie embeddings
  const interactions = sqliteDb.prepare(`
    SELECT ui.*, me.embedding
    FROM user_interactions ui
    JOIN movie_embeddings me ON me.rowid = ui.movie_id
    WHERE ui.user_id = ? AND ui.movie_id IS NOT NULL
    ORDER BY ui.created_at DESC
    LIMIT 50
  `).all(userId) as (UserInteraction & { embedding: Buffer })[];

  if (interactions.length === 0) {
    return false;
  }

  // Calculate weighted average of interaction embeddings
  const weightedSum = new Float32Array(EMBEDDING_DIMENSIONS);
  let totalWeight = 0;

  for (const interaction of interactions) {
    const typeWeight = INTERACTION_WEIGHTS[interaction.interaction_type] || 0.1;
    const timeDecay = calculateTimeDecay(interaction.created_at);
    const weight = typeWeight * timeDecay;

    const embedding = bufferToFloatArray(interaction.embedding);
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      weightedSum[i]! += embedding[i]! * weight;
    }
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return false;
  }

  // Normalize
  const behaviorEmbedding = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    behaviorEmbedding[i] = weightedSum[i]! / totalWeight;
  }

  // Combine with existing embedding if present
  let finalEmbedding: Float32Array;

  if (user.preference_embedding) {
    const existingEmbedding = bufferToFloatArray(user.preference_embedding);
    finalEmbedding = new Float32Array(EMBEDDING_DIMENSIONS);

    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      finalEmbedding[i] =
        existingEmbedding[i]! * EXISTING_EMBEDDING_WEIGHT +
        behaviorEmbedding[i]! * NEW_BEHAVIOR_WEIGHT;
    }
  } else {
    finalEmbedding = behaviorEmbedding;
  }

  // Normalize the final embedding
  let magnitude = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    magnitude += finalEmbedding[i]! * finalEmbedding[i]!;
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude > 0) {
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      finalEmbedding[i] = finalEmbedding[i]! / magnitude;
    }
  }

  // Update user embedding
  const embeddingBuffer = floatArrayToBuffer(finalEmbedding);
  updateUserEmbedding(userId, embeddingBuffer);

  return true;
}

export function getInteractionStats(userId: number): {
  total: number;
  byType: Record<InteractionType, number>;
  recentMovies: { movie_id: number; count: number }[];
} {
  const total = sqliteDb.prepare(`
    SELECT COUNT(*) as count FROM user_interactions WHERE user_id = ?
  `).get(userId) as { count: number };

  const byTypeRows = sqliteDb.prepare(`
    SELECT interaction_type, COUNT(*) as count
    FROM user_interactions
    WHERE user_id = ?
    GROUP BY interaction_type
  `).all(userId) as { interaction_type: InteractionType; count: number }[];

  const byType: Record<InteractionType, number> = {
    search: 0,
    view: 0,
    favorite: 0,
    click: 0,
  };

  for (const row of byTypeRows) {
    byType[row.interaction_type] = row.count;
  }

  const recentMovies = sqliteDb.prepare(`
    SELECT movie_id, COUNT(*) as count
    FROM user_interactions
    WHERE user_id = ? AND movie_id IS NOT NULL
    GROUP BY movie_id
    ORDER BY count DESC
    LIMIT 10
  `).all(userId) as { movie_id: number; count: number }[];

  return { total: total.count, byType, recentMovies };
}

// Trigger embedding update after significant behavior (e.g., every 10 interactions)
const UPDATE_THRESHOLD = 10;

export function shouldUpdateEmbedding(userId: number): boolean {
  const count = sqliteDb.prepare(`
    SELECT COUNT(*) as count FROM user_interactions
    WHERE user_id = ? AND created_at > datetime('now', '-1 day')
  `).get(userId) as { count: number };

  return count.count >= UPDATE_THRESHOLD && count.count % UPDATE_THRESHOLD === 0;
}
