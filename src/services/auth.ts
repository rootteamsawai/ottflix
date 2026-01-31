import { createClient, SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import "dotenv/config";
import { sqliteDb } from "../db/index.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Server-side Supabase client (lazy initialization)
let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY ||
      SUPABASE_URL === "your_supabase_project_url" ||
      !SUPABASE_URL.startsWith("http")) {
    return null;
  }

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

export interface User {
  id: number;
  supabase_id: string;
  email: string;
  name: string | null;
  picture: string | null;
  preference_embedding: Buffer | null;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
}

export interface AuthResult {
  user: User;
  isNewUser: boolean;
}

/**
 * Verify Supabase access token and get/create local user
 */
export async function verifyAndGetUser(accessToken: string): Promise<User | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("Supabase not configured, auth disabled");
    return null;
  }

  try {
    // Verify token with Supabase
    const { data: { user: supabaseUser }, error } = await client.auth.getUser(accessToken);

    if (error || !supabaseUser) {
      console.error("Supabase auth error:", error);
      return null;
    }

    // Get or create local user
    return getOrCreateUser(supabaseUser);
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

/**
 * Get or create local user from Supabase user
 */
export function getOrCreateUser(supabaseUser: SupabaseUser): User {
  const supabaseId = supabaseUser.id;
  const email = supabaseUser.email || "";
  const name = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || null;
  const picture = supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture || null;

  // Check if user exists
  let user = sqliteDb.prepare(`
    SELECT * FROM users WHERE supabase_id = ?
  `).get(supabaseId) as User | undefined;

  if (!user) {
    // Create new user
    const result = sqliteDb.prepare(`
      INSERT INTO users (supabase_id, email, name, picture)
      VALUES (?, ?, ?, ?)
    `).run(supabaseId, email, name, picture);

    user = sqliteDb.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(result.lastInsertRowid) as User;
  } else {
    // Update existing user's info
    sqliteDb.prepare(`
      UPDATE users SET name = ?, picture = ?, email = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, picture, email, user.id);

    user = sqliteDb.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(user.id) as User;
  }

  return user;
}

export function getUserById(userId: number): User | null {
  const user = sqliteDb.prepare(`
    SELECT * FROM users WHERE id = ?
  `).get(userId) as User | undefined;

  return user || null;
}

export function getUserBySupabaseId(supabaseId: string): User | null {
  const user = sqliteDb.prepare(`
    SELECT * FROM users WHERE supabase_id = ?
  `).get(supabaseId) as User | undefined;

  return user || null;
}

export function updateUserEmbedding(userId: number, embedding: Buffer): void {
  sqliteDb.prepare(`
    UPDATE users SET preference_embedding = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(embedding, userId);
}

export function markOnboardingCompleted(userId: number): void {
  sqliteDb.prepare(`
    UPDATE users SET onboarding_completed = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(userId);
}

/**
 * Get user from Authorization header (Bearer token)
 */
export async function getUserFromToken(authHeader: string | undefined): Promise<User | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);
  return verifyAndGetUser(token);
}
