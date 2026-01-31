/**
 * Personalization service for Netflix history parsing and movie matching
 */

export interface Movie {
  id: number;
  tmdb_id: number;
  title: string;
  title_ja: string | null;
  poster_path: string | null;
  vote_average: number | null;
  genres: string | null;
}

export interface NetflixHistoryEntry {
  title: string;
  date: string;
}

/**
 * Parse Netflix CSV title to extract the base title
 * Examples:
 * - "Breaking Bad: Season 1: Pilot" → "Breaking Bad"
 * - "The Lord of the Rings: The Fellowship of the Ring" → kept as is (no season pattern)
 */
export function parseNetflixTitle(title: string): string {
  // Check for TV show season pattern
  const seasonPattern = /^(.+?):\s*Season\s*\d+/i;
  const match = title.match(seasonPattern);

  if (match && match[1]) {
    return match[1].trim();
  }

  // For movies with colons, try to detect if it's a subtitle
  // Keep the full title if it doesn't match common patterns
  return title.trim();
}

/**
 * Fuzzy match a Netflix title against database movies
 */
export function fuzzyMatchTitle(netflixTitle: string, dbMovies: Movie[]): Movie | null {
  const parsed = parseNetflixTitle(netflixTitle);
  const normalized = parsed.toLowerCase().trim();

  // 1. Exact match (case-insensitive)
  let match = dbMovies.find(
    (m) =>
      m.title.toLowerCase() === normalized ||
      m.title_ja?.toLowerCase() === normalized
  );
  if (match) return match;

  // 2. Partial match (contains)
  match = dbMovies.find(
    (m) =>
      m.title.toLowerCase().includes(normalized) ||
      normalized.includes(m.title.toLowerCase()) ||
      (m.title_ja && m.title_ja.toLowerCase().includes(normalized)) ||
      (m.title_ja && normalized.includes(m.title_ja.toLowerCase()))
  );

  return match || null;
}

/**
 * Parse Netflix CSV content
 */
export function parseNetflixCsv(csvContent: string): NetflixHistoryEntry[] {
  const lines = csvContent.split('\n');
  const entries: NetflixHistoryEntry[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Parse CSV line with quoted fields
    const match = line.match(/^"?([^"]*)"?,\s*"?([^"]*)"?$/);
    if (match && match[1] && match[2]) {
      entries.push({
        title: match[1].trim(),
        date: match[2].trim(),
      });
    } else {
      // Try simple comma split for unquoted entries
      const parts = line.split(',');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        entries.push({
          title: parts[0].replace(/^"|"$/g, '').trim(),
          date: parts[1].replace(/^"|"$/g, '').trim(),
        });
      }
    }
  }

  return entries;
}

/**
 * Deduplicate Netflix history entries by title
 * (e.g., multiple episodes of the same show)
 */
export function deduplicateEntries(entries: NetflixHistoryEntry[]): NetflixHistoryEntry[] {
  const seen = new Set<string>();
  const deduped: NetflixHistoryEntry[] = [];

  for (const entry of entries) {
    const parsed = parseNetflixTitle(entry.title);
    const key = parsed.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push({
        ...entry,
        title: parsed, // Use parsed title for matching
      });
    }
  }

  return deduped;
}
