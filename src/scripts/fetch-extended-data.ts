import "dotenv/config";
import { sqliteDb } from "../db/index.js";
import {
  getMovieFullDetails,
  getMovieFullDetailsEnglish,
  delay,
} from "../services/tmdb.js";

interface Movie {
  id: number;
  tmdb_id: number;
  title: string;
}

async function fetchExtendedData() {
  console.log("Fetching extended data for all movies...");

  // Get all movies from database
  const movies = sqliteDb.prepare(`SELECT id, tmdb_id, title FROM movies`).all() as Movie[];
  console.log(`Found ${movies.length} movies to process`);

  // Prepare insert statements
  const insertPerson = sqliteDb.prepare(`
    INSERT OR IGNORE INTO people (tmdb_id, name, profile_path)
    VALUES (?, ?, ?)
  `);

  const getPersonId = sqliteDb.prepare(`
    SELECT id FROM people WHERE tmdb_id = ?
  `);

  const insertCast = sqliteDb.prepare(`
    INSERT OR IGNORE INTO movie_cast (movie_id, person_id, character, cast_order)
    VALUES (?, ?, ?, ?)
  `);

  const insertCrew = sqliteDb.prepare(`
    INSERT OR IGNORE INTO movie_crew (movie_id, person_id, department, job)
    VALUES (?, ?, ?, ?)
  `);

  const insertVideo = sqliteDb.prepare(`
    INSERT OR IGNORE INTO movie_videos (movie_id, video_key, name, site, video_type, official)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertReview = sqliteDb.prepare(`
    INSERT OR IGNORE INTO movie_reviews (movie_id, tmdb_review_id, author, content, rating, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertSimilar = sqliteDb.prepare(`
    INSERT OR IGNORE INTO movie_similar (movie_id, similar_tmdb_id, similarity_order)
    VALUES (?, ?, ?)
  `);

  const insertExtended = sqliteDb.prepare(`
    INSERT OR REPLACE INTO movie_details_extended
    (movie_id, budget, revenue, tagline, tagline_ja, status, imdb_id, homepage, production_companies, production_countries, spoken_languages)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let processed = 0;
  let errors = 0;

  for (const movie of movies) {
    try {
      // Fetch full details with Japanese language
      const details = await getMovieFullDetails(movie.tmdb_id, "ja-JP");

      // Fetch English tagline separately
      const englishDetails = await getMovieFullDetailsEnglish(movie.tmdb_id);

      // Process cast (top 15)
      const cast = details.credits?.cast?.slice(0, 15) || [];
      for (const member of cast) {
        // Insert person
        insertPerson.run(member.id, member.name, member.profile_path);
        // Get person id
        const person = getPersonId.get(member.id) as { id: number } | undefined;
        if (person) {
          insertCast.run(movie.id, person.id, member.character, member.order);
        }
      }

      // Process crew (directors, writers)
      const importantJobs = ["Director", "Screenplay", "Writer", "Story"];
      const crew = (details.credits?.crew || []).filter((c) =>
        importantJobs.includes(c.job)
      );
      for (const member of crew) {
        insertPerson.run(member.id, member.name, member.profile_path);
        const person = getPersonId.get(member.id) as { id: number } | undefined;
        if (person) {
          insertCrew.run(movie.id, person.id, member.department, member.job);
        }
      }

      // Process videos (trailers and teasers only)
      const videos = (details.videos?.results || [])
        .filter((v) => v.site === "YouTube" && ["Trailer", "Teaser"].includes(v.type))
        .slice(0, 5);
      for (const video of videos) {
        insertVideo.run(
          movie.id,
          video.key,
          video.name,
          video.site,
          video.type,
          video.official ? 1 : 0
        );
      }

      // Process reviews (top 5)
      const reviews = (details.reviews?.results || []).slice(0, 5);
      for (const review of reviews) {
        insertReview.run(
          movie.id,
          review.id,
          review.author,
          review.content,
          review.author_details?.rating || null,
          review.created_at
        );
      }

      // Process similar movies (top 10)
      const similar = (details.similar?.results || []).slice(0, 10);
      for (let i = 0; i < similar.length; i++) {
        const sim = similar[i];
        if (sim) {
          insertSimilar.run(movie.id, sim.id, i);
        }
      }

      // Process extended details
      insertExtended.run(
        movie.id,
        details.budget || 0,
        details.revenue || 0,
        englishDetails.tagline || null,
        details.tagline || null,
        details.status || null,
        details.imdb_id || null,
        details.homepage || null,
        JSON.stringify(details.production_companies || []),
        JSON.stringify(details.production_countries || []),
        JSON.stringify(details.spoken_languages || [])
      );

      processed++;
      if (processed % 50 === 0) {
        console.log(`Processed ${processed}/${movies.length} movies`);
      }

      // Rate limiting: TMDb allows 40 requests/second, we make 2 requests per movie
      await delay(100);
    } catch (error) {
      errors++;
      console.error(`Error processing movie ${movie.tmdb_id} (${movie.title}):`, error);
    }
  }

  console.log(`\nCompleted! Processed: ${processed}, Errors: ${errors}`);

  // Print summary
  const stats = {
    people: (sqliteDb.prepare(`SELECT COUNT(*) as count FROM people`).get() as { count: number }).count,
    cast: (sqliteDb.prepare(`SELECT COUNT(*) as count FROM movie_cast`).get() as { count: number }).count,
    crew: (sqliteDb.prepare(`SELECT COUNT(*) as count FROM movie_crew`).get() as { count: number }).count,
    videos: (sqliteDb.prepare(`SELECT COUNT(*) as count FROM movie_videos`).get() as { count: number }).count,
    reviews: (sqliteDb.prepare(`SELECT COUNT(*) as count FROM movie_reviews`).get() as { count: number }).count,
    similar: (sqliteDb.prepare(`SELECT COUNT(*) as count FROM movie_similar`).get() as { count: number }).count,
    extended: (sqliteDb.prepare(`SELECT COUNT(*) as count FROM movie_details_extended`).get() as { count: number }).count,
  };

  console.log("\nDatabase stats:");
  console.log(`  People: ${stats.people}`);
  console.log(`  Cast entries: ${stats.cast}`);
  console.log(`  Crew entries: ${stats.crew}`);
  console.log(`  Videos: ${stats.videos}`);
  console.log(`  Reviews: ${stats.reviews}`);
  console.log(`  Similar entries: ${stats.similar}`);
  console.log(`  Extended details: ${stats.extended}`);

  sqliteDb.close();
}

fetchExtendedData().catch(console.error);
