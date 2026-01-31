import {
  sqliteTable,
  integer,
  text,
  real,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const movies = sqliteTable("movies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  overview: text("overview"),
  overviewJa: text("overview_ja"),
  genres: text("genres", { mode: "json" }).$type<string[]>(),
  releaseDate: text("release_date"),
  runtime: integer("runtime"),
  popularity: real("popularity"),
  voteAverage: real("vote_average"),
  posterPath: text("poster_path"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;
