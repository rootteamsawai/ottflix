import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { sqliteDb } from "../db/index.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/api/auth/callback";
const JWT_SECRET = process.env.JWT_SECRET || "ottflix_jwt_secret";

const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL
);

export interface User {
  id: number;
  google_id: string;
  email: string;
  name: string | null;
  picture: string | null;
  preference_embedding: Buffer | null;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
}

export interface JWTPayload {
  userId: number;
  email: string;
  name: string | null;
}

export function getAuthUrl(): string {
  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });
}

export async function handleCallback(code: string): Promise<{
  token: string;
  user: User;
  isNewUser: boolean;
}> {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user info from Google
  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Invalid token payload");
  }

  const googleId = payload.sub;
  const email = payload.email!;
  const name = payload.name || null;
  const picture = payload.picture || null;

  // Check if user exists
  let user = sqliteDb.prepare(`
    SELECT * FROM users WHERE google_id = ?
  `).get(googleId) as User | undefined;

  let isNewUser = false;

  if (!user) {
    // Create new user
    isNewUser = true;
    const result = sqliteDb.prepare(`
      INSERT INTO users (google_id, email, name, picture)
      VALUES (?, ?, ?, ?)
    `).run(googleId, email, name, picture);

    user = sqliteDb.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(result.lastInsertRowid) as User;
  } else {
    // Update existing user's info
    sqliteDb.prepare(`
      UPDATE users SET name = ?, picture = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, picture, user.id);

    user = sqliteDb.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(user.id) as User;
  }

  // Generate JWT token
  const jwtPayload: JWTPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
  };

  const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: "7d" });

  return { token, user, isNewUser };
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
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

export function getUserFromToken(authHeader: string | undefined): User | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return null;
  }

  return getUserById(payload.userId);
}
