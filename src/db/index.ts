import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import "dotenv/config";

const DB_PATH = process.env.DATABASE_PATH || "data/ottflix.db";

// Create database connection
const sqlite = new Database(DB_PATH);

// Load sqlite-vec extension
sqliteVec.load(sqlite);

export const db = drizzle(sqlite, { schema });
export const sqliteDb = sqlite;

export { schema };
