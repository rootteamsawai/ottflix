import "dotenv/config";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN;

if (!TMDB_ACCESS_TOKEN) {
  throw new Error("TMDB_ACCESS_TOKEN environment variable is not set");
}

export interface TMDbMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  genre_ids: number[];
  release_date: string;
  popularity: number;
  vote_average: number;
  poster_path: string | null;
}

export interface TMDbMovieDetails extends TMDbMovie {
  runtime: number | null;
  genres: { id: number; name: string }[];
}

export interface TMDbDiscoverResponse {
  page: number;
  results: TMDbMovie[];
  total_pages: number;
  total_results: number;
}

interface GenreMap {
  [key: number]: string;
}

// TMDb genre ID to name mapping
const GENRE_MAP: GenreMap = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      // Rate limited, wait and retry
      const retryAfter = response.headers.get("Retry-After");
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000;
      console.log(`Rate limited, waiting ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      continue;
    }

    if (!response.ok) {
      throw new Error(`TMDb API error: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  throw new Error("Max retries exceeded");
}

export async function discoverMovies(
  page: number,
  language: string = "ja-JP"
): Promise<TMDbDiscoverResponse> {
  const url = new URL(`${TMDB_BASE_URL}/discover/movie`);
  url.searchParams.set("page", page.toString());
  url.searchParams.set("language", language);
  url.searchParams.set("sort_by", "popularity.desc");
  url.searchParams.set("include_adult", "false");

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}

export async function getMovieDetails(
  movieId: number,
  language: string = "ja-JP"
): Promise<TMDbMovieDetails> {
  const url = new URL(`${TMDB_BASE_URL}/movie/${movieId}`);
  url.searchParams.set("language", language);

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}

export function genreIdsToNames(genreIds: number[]): string[] {
  return genreIds
    .map((id) => GENRE_MAP[id])
    .filter((name): name is string => name !== undefined);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

export interface WatchProvidersResult {
  flatrate?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

export interface WatchProvidersResponse {
  id: number;
  results: {
    [countryCode: string]: WatchProvidersResult;
  };
}

export async function getWatchProviders(
  movieId: number,
  locale: string = "JP"
): Promise<WatchProvidersResult | null> {
  const url = new URL(`${TMDB_BASE_URL}/movie/${movieId}/watch/providers`);

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const data: WatchProvidersResponse = await response.json();

  // Return providers for the specified locale (default: Japan)
  return data.results[locale] || null;
}

// Extended interfaces for full movie details
export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface Video {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface Review {
  id: string;
  author: string;
  content: string;
  author_details: {
    rating: number | null;
  };
  created_at: string;
}

export interface SimilarMovie {
  id: number;
  title: string;
  poster_path: string | null;
}

export interface ProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface ProductionCountry {
  iso_3166_1: string;
  name: string;
}

export interface SpokenLanguage {
  iso_639_1: string;
  name: string;
  english_name: string;
}

export interface MovieFullDetails extends TMDbMovieDetails {
  budget: number;
  revenue: number;
  tagline: string;
  status: string;
  imdb_id: string | null;
  homepage: string | null;
  production_companies: ProductionCompany[];
  production_countries: ProductionCountry[];
  spoken_languages: SpokenLanguage[];
  credits: {
    cast: CastMember[];
    crew: CrewMember[];
  };
  videos: {
    results: Video[];
  };
  reviews: {
    results: Review[];
  };
  similar: {
    results: SimilarMovie[];
  };
}

export async function getMovieFullDetails(
  movieId: number,
  language: string = "ja-JP"
): Promise<MovieFullDetails> {
  const url = new URL(`${TMDB_BASE_URL}/movie/${movieId}`);
  url.searchParams.set("language", language);
  url.searchParams.set("append_to_response", "credits,videos,reviews,similar");

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}

export async function getMovieFullDetailsEnglish(
  movieId: number
): Promise<{ tagline: string; videos?: { results: Video[] }; credits?: { cast: CastMember[]; crew: CrewMember[] } }> {
  const url = new URL(`${TMDB_BASE_URL}/movie/${movieId}`);
  url.searchParams.set("language", "en-US");
  url.searchParams.set("append_to_response", "videos,credits");

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}

// Now Playing movies response
export interface NowPlayingResponse {
  page: number;
  results: TMDbMovie[];
  total_pages: number;
  total_results: number;
  dates: {
    maximum: string;
    minimum: string;
  };
}

// Get movies currently in theaters
export async function getNowPlaying(
  region: string = "JP",
  language: string = "ja-JP",
  page: number = 1
): Promise<NowPlayingResponse> {
  const url = new URL(`${TMDB_BASE_URL}/movie/now_playing`);
  url.searchParams.set("region", region);
  url.searchParams.set("language", language);
  url.searchParams.set("page", page.toString());

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}
