import { createClerkClient, verifyToken } from "@clerk/backend";
import "dotenv/config";
import { sqliteDb } from "../db/index.js";
import { appendFileSync } from "fs";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || "";
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY || "";

// Clerk client (lazy initialization)
let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient() {
  if (!CLERK_SECRET_KEY || CLERK_SECRET_KEY === "your_clerk_secret_key") {
    return null;
  }

  if (!clerkClient) {
    clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });
  }
  return clerkClient;
}

export interface User {
  id: number;
  clerk_id: string;
  email: string;
  name: string | null;
  picture: string | null;
  preference_embedding: Buffer | null;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
}

/**
 * Verify Clerk session token and get/create local user
 */
export async function verifyAndGetUser(sessionToken: string): Promise<User | null> {
  const clerk = getClerkClient();
  if (!clerk) {
    console.warn("Clerk not configured, auth disabled");
    return null;
  }

  if (!CLERK_SECRET_KEY) {
    console.warn("CLERK_SECRET_KEY not set");
    return null;
  }

  try {
    appendFileSync("/tmp/auth-debug.log", `[${new Date().toISOString()}] Verifying token, secretKey: ${CLERK_SECRET_KEY.substring(0, 20)}...\n`);

    // Verify the session token using standalone verifyToken function
    const verifiedToken = await verifyToken(sessionToken, {
      secretKey: CLERK_SECRET_KEY,
    });

    appendFileSync("/tmp/auth-debug.log", `[${new Date().toISOString()}] Token verified, sub: ${verifiedToken.sub}\n`);
    const clerkUserId = verifiedToken.sub;

    if (!clerkUserId) {
      return null;
    }

    // Get user details from Clerk
    const clerkUser = await clerk.users.getUser(clerkUserId);

    // Get or create local user
    return getOrCreateUser(
      clerkUserId,
      clerkUser.emailAddresses[0]?.emailAddress || "",
      clerkUser.firstName ? `${clerkUser.firstName} ${clerkUser.lastName || ""}`.trim() : null,
      clerkUser.imageUrl || null
    );
  } catch (error: any) {
    appendFileSync("/tmp/auth-debug.log", `[${new Date().toISOString()}] Token verification failed: ${error.message}\n${error.stack}\n`);
    console.error("Token verification failed:", error);
    return null;
  }
}

/**
 * Get or create local user from Clerk user data
 */
function getOrCreateUser(
  clerkId: string,
  email: string,
  name: string | null,
  picture: string | null
): User {
  // Check if user exists (try clerk_id first, fall back to supabase_id for migration)
  let user = sqliteDb.prepare(`
    SELECT * FROM users WHERE clerk_id = ?
  `).get(clerkId) as User | undefined;

  if (!user) {
    // Try supabase_id for backwards compatibility
    user = sqliteDb.prepare(`
      SELECT * FROM users WHERE supabase_id = ?
    `).get(clerkId) as User | undefined;
  }

  if (!user) {
    // Create new user (use clerkId for both clerk_id and supabase_id for backwards compatibility)
    const result = sqliteDb.prepare(`
      INSERT INTO users (clerk_id, supabase_id, email, name, picture)
      VALUES (?, ?, ?, ?, ?)
    `).run(clerkId, clerkId, email, name, picture);

    user = sqliteDb.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(result.lastInsertRowid) as User;
  } else {
    // Update existing user's info
    sqliteDb.prepare(`
      UPDATE users SET name = ?, picture = ?, email = ?, clerk_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, picture, email, clerkId, user.id);

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
