import OpenAI from "openai";
import { sqliteDb } from "../db/index.js";
import { generateEmbedding } from "./embeddings.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface MovieRecommendation {
  id: number;
  title: string;
  title_ja: string | null;
  poster_path: string | null;
  overview_ja: string | null;
  vote_average: number | null;
  release_date: string | null;
}

export interface ChatResponse {
  message: string;
  recommendation?: MovieRecommendation; // 後方互換性のため（最初の1件）
  recommendations?: MovieRecommendation[]; // 複数の推薦
}

interface MovieCandidate {
  id: number;
  title: string;
  title_ja: string | null;
  overview_ja: string | null;
  genres: string | null;
  poster_path: string | null;
  vote_average: number | null;
  release_date: string | null;
  distance?: number;
}

function serializeFloat32(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i]!, i * 4);
  }
  return buf;
}

async function searchMoviesByText(query: string, limit: number): Promise<MovieCandidate[]> {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    const queryBlob = serializeFloat32(queryEmbedding);

    // Find similar movies using vector search
    const results = sqliteDb.prepare(`
      SELECT
        m.id, m.title, m.title_ja, m.overview_ja, m.genres,
        m.poster_path, m.vote_average, m.release_date, e.distance
      FROM movie_embeddings e
      JOIN movies m ON m.id = e.rowid
      WHERE e.embedding MATCH ? AND k = ?
      ORDER BY e.distance
    `).all(queryBlob, limit) as MovieCandidate[];

    return results;
  } catch (error) {
    console.error("Vector search failed, falling back to basic search:", error);
    // Fallback to basic search if vector search fails
    const results = sqliteDb.prepare(`
      SELECT id, title, title_ja, overview_ja, genres, poster_path, vote_average, release_date
      FROM movies
      ORDER BY popularity DESC
      LIMIT ?
    `).all(limit) as MovieCandidate[];
    return results;
  }
}

function parseGenres(genresJson: string | null): string {
  if (!genresJson) return "";
  try {
    const genres = JSON.parse(genresJson) as string[];
    return genres.join(", ");
  } catch {
    return "";
  }
}

// ジャンルキーワードのマッピング
const GENRE_KEYWORDS: Record<string, string[]> = {
  "サスペンス": ["サスペンス", "スリラー", "緊張感", "謎", "ミステリー"],
  "スリラー": ["スリラー", "サスペンス", "緊張", "恐怖"],
  "ホラー": ["ホラー", "恐怖", "怖い", "怪奇", "オカルト"],
  "アクション": ["アクション", "バトル", "戦闘", "爆発"],
  "コメディ": ["コメディ", "笑い", "面白い", "ギャグ"],
  "ロマンス": ["ロマンス", "恋愛", "ラブストーリー"],
  "SF": ["SF", "サイエンスフィクション", "宇宙", "未来"],
  "ファンタジー": ["ファンタジー", "魔法", "異世界"],
  "アニメ": ["アニメ", "アニメーション"],
  "ドキュメンタリー": ["ドキュメンタリー", "実話", "ノンフィクション"],
};

function extractGenreFromMessages(messages: ChatMessage[]): string | null {
  const allText = messages.map(m => m.content).join(" ");
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (allText.includes(keyword)) {
        return genre;
      }
    }
  }
  return null;
}

// DBのジャンルフィールドでマッチさせるキーワード
function getGenreMatchKeywords(genre: string): string[] {
  const mapping: Record<string, string[]> = {
    "サスペンス": ["thriller", "スリラー", "mystery", "ミステリー", "crime", "犯罪"],
    "スリラー": ["thriller", "スリラー", "mystery", "ミステリー", "crime", "犯罪"],
    "ホラー": ["horror", "ホラー"],
    "アクション": ["action", "アクション"],
    "コメディ": ["comedy", "コメディ"],
    "ロマンス": ["romance", "ロマンス"],
    "SF": ["science fiction", "sf", "サイエンスフィクション"],
    "ファンタジー": ["fantasy", "ファンタジー"],
    "アニメ": ["animation", "アニメ"],
    "ドキュメンタリー": ["documentary", "ドキュメンタリー"],
  };
  return mapping[genre] || [];
}

interface DismissedMovieInfo {
  title: string;
  genres: string | null;
}

export async function generateChatResponse(
  messages: ChatMessage[],
  excludeMovieIds: number[] = [],
  dismissedMovieInfo: DismissedMovieInfo[] = []
): Promise<ChatResponse> {
  // Get the latest user message for context-aware search
  const lastUserMsg = messages.filter(m => m.role === "user").pop()?.content || "";

  // Build a search query from conversation context
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content);
  let searchQuery = userMessages.slice(-3).join(" "); // Use last 3 user messages for context

  // ジャンルを抽出して検索クエリに強調して追加
  const detectedGenre = extractGenreFromMessages(messages);
  if (detectedGenre) {
    // ジャンルを検索クエリの先頭に追加して重み付け
    searchQuery = `${detectedGenre} ${detectedGenre}映画 ${searchQuery}`;
  }

  // Search for candidate movies using vector search
  let candidates = await searchMoviesByText(searchQuery, 100); // より多く取得してフィルタ

  // 低評価の映画を除外（6.5以上のみ）
  candidates = candidates.filter(m => (m.vote_average ?? 0) >= 6.5);

  // 視聴済み映画を候補から除外
  if (excludeMovieIds.length > 0) {
    candidates = candidates.filter(m => !excludeMovieIds.includes(m.id));
  }

  // 名作・クラシック映画も追加（評価7.5以上の映画をジャンルから追加）
  if (detectedGenre) {
    const genreMatchKeywords = getGenreMatchKeywords(detectedGenre);
    const classicMovies = sqliteDb.prepare(`
      SELECT id, title, title_ja, overview_ja, genres, poster_path, vote_average, release_date
      FROM movies
      WHERE vote_average >= 7.5
      ORDER BY vote_average DESC, popularity DESC
      LIMIT 50
    `).all() as MovieCandidate[];

    // ジャンルにマッチする名作を追加
    const matchingClassics = classicMovies.filter(m => {
      const genres = (m.genres || "").toLowerCase();
      return genreMatchKeywords.some(kw => genres.includes(kw));
    });

    // 既存の候補にない映画を追加（視聴済みは除外）
    const existingIds = new Set(candidates.map(c => c.id));
    const excludeSet = new Set(excludeMovieIds);
    for (const classic of matchingClassics) {
      if (!existingIds.has(classic.id) && !excludeSet.has(classic.id)) {
        candidates.push(classic);
        existingIds.add(classic.id);
      }
    }
  }

  // ジャンルが検出された場合、マッチする映画を優先
  if (detectedGenre) {
    const genreMatchKeywords = getGenreMatchKeywords(detectedGenre);

    // 候補をジャンルマッチ＋評価順でソート
    candidates = candidates.sort((a, b) => {
      const aGenres = (a.genres || "").toLowerCase();
      const bGenres = (b.genres || "").toLowerCase();
      const aMatch = genreMatchKeywords.some(kw => aGenres.includes(kw));
      const bMatch = genreMatchKeywords.some(kw => bGenres.includes(kw));
      // まずジャンルマッチで優先
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      // 同じ場合は評価順
      return (b.vote_average ?? 0) - (a.vote_average ?? 0);
    });
  } else {
    // ジャンル指定なしの場合は評価順
    candidates = candidates.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
  }

  // Create candidate list for the prompt with detailed information
  const candidateText = candidates
    .slice(0, 15)
    .map(m => {
      const genres = parseGenres(m.genres);
      const year = m.release_date?.split("-")[0] || "不明";
      const rating = m.vote_average?.toFixed(1) || "-";
      const overview = (m.overview_ja || "").substring(0, 60);
      return `・${m.title_ja || m.title} (${year}, ${genres}, ★${rating})\n  ${overview}${overview.length >= 60 ? "..." : ""}`;
    })
    .join("\n");

  // Build conversation history
  const historyText = messages
    .map(m => `${m.role === "user" ? "ユーザー" : "AI"}: ${m.content}`)
    .join("\n");

  // 既に推薦した映画を抽出
  const alreadyRecommended: string[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const matches = [...msg.content.matchAll(/【(.+?)】/g)];
      for (const match of matches) {
        if (match[1]) {
          alreadyRecommended.push(match[1]);
        }
      }
    }
  }
  const alreadyRecommendedText = alreadyRecommended.length > 0
    ? `\n\n【既に推薦済みの映画 - 絶対に再度推薦しないこと】\n${alreadyRecommended.join("、")}`
    : "";

  // ユーザーが興味なしとした映画の情報を整理
  let dismissedMoviesText = "";
  if (dismissedMovieInfo.length > 0) {
    // ジャンルを集計して、ユーザーが好まないジャンルを把握
    const dislikedGenres = new Set<string>();
    const dismissedTitles: string[] = [];
    for (const movie of dismissedMovieInfo) {
      dismissedTitles.push(movie.title);
      if (movie.genres) {
        try {
          const genres = JSON.parse(movie.genres) as string[];
          genres.forEach(g => dislikedGenres.add(g));
        } catch {}
      }
    }
    dismissedMoviesText = `\n\n【ユーザーが興味なしとした映画 - 絶対に推薦しないこと】
${dismissedTitles.slice(0, 10).join("、")}${dismissedTitles.length > 10 ? ` 他${dismissedTitles.length - 10}作品` : ""}

【ユーザーが避けている可能性のあるジャンル（参考情報）】
${[...dislikedGenres].slice(0, 5).join("、")}
※ただし、ユーザーが明示的にこれらのジャンルを求めた場合は推薦可`;
  }

  const systemPrompt = `あなたは映画ソムリエです。ユーザーとの会話から好みを理解し、最適な映画を推薦します。

【あなたの役割】
- ユーザーの好みを引き出す具体的な質問をする
- 候補リストから最適な映画を選ぶ
- 会話の流れを考慮して候補を絞り込む

【会話履歴】
${historyText}

【候補映画リスト】
${candidateText}${alreadyRecommendedText}${dismissedMoviesText}

【最重要ルール - ジャンルの厳守】
ユーザーが特定のジャンルを指定した場合（例：サスペンス、ホラー、アクション、コメディなど）、
そのジャンルに該当する映画のみを推薦してください。
- サスペンス → スリラー、ミステリー、犯罪映画など緊張感のある映画
- ホラー → 恐怖映画、怪奇映画
- アクション → アクション映画
- コメディ → 喜劇、笑える映画
- ロマンス → 恋愛映画
候補リストの各映画にはジャンル情報が含まれています。必ずジャンルを確認し、
ユーザーのリクエストに合わないジャンルの映画は絶対に推薦しないでください。
例：サスペンスを求めているユーザーにドラマやヒューマンドラマを推薦してはいけません。

【会話の進め方】
1. ユーザーの好みを深く理解するために2-3回質問する
   - 好きなジャンルや雰囲気
   - 古い名作 vs 新しい映画の好み
   - 邦画 vs 洋画の好み
   - 好きな映画や印象に残った作品
2. 十分に好みを把握したら、3-5作品を推薦する
3. 推薦後、ユーザーが「他にも」「もっと」と言ったら、別の作品を推薦する

【重要】必ず最後は映画を推薦して会話を締めくくること

【推薦時のルール】
- 推薦時は映画タイトルを【】で囲む
- 推薦理由も簡潔に説明する
- 同じ映画を繰り返し推薦しない
- 日本語でフレンドリーに会話する

【推薦の多様性】
- 古典的な名作（1980年代以前）も積極的に含める
- 新しい話題作も含める
- 異なる国の映画を混ぜる
- 異なるサブジャンルを含める`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
    ],
    temperature: 0.5,
    max_tokens: 500,
  });

  const assistantMessage = response.choices[0]?.message?.content || "すみません、エラーが発生しました。もう一度お試しください。";

  // Extract all recommended movie titles from 【】
  const titleMatches = [...assistantMessage.matchAll(/【(.+?)】/g)];
  const recommendations: MovieRecommendation[] = [];
  const seenIds = new Set<number>();
  const excludeSet = new Set(excludeMovieIds);

  for (const match of titleMatches) {
    const recTitle = match[1];

    // Search for the movie in candidates
    let recMovie = candidates.find(
      m => m.title === recTitle || m.title_ja === recTitle
    );

    if (!recMovie) {
      // Try to find the movie in the database directly
      recMovie = sqliteDb.prepare(`
        SELECT id, title, title_ja, poster_path, overview_ja, vote_average, release_date
        FROM movies
        WHERE title = ? OR title_ja = ?
        LIMIT 1
      `).get(recTitle, recTitle) as MovieCandidate | undefined;
    }

    // 視聴済み映画は除外
    if (recMovie && !seenIds.has(recMovie.id) && !excludeSet.has(recMovie.id)) {
      seenIds.add(recMovie.id);
      recommendations.push({
        id: recMovie.id,
        title: recMovie.title,
        title_ja: recMovie.title_ja,
        poster_path: recMovie.poster_path,
        overview_ja: recMovie.overview_ja,
        vote_average: recMovie.vote_average,
        release_date: recMovie.release_date,
      });
    }
  }

  return {
    message: assistantMessage,
    recommendation: recommendations[0], // 後方互換性
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}
