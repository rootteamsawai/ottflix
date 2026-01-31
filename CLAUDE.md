# OTTflix - Phase 1: データ基盤構築

## ゴール
1. TMDb APIから映画データ1000件を取得
2. SQLite + sqlite-vec にスキーマ作成・データ保存
3. OpenAI Embeddings で埋め込み生成・保存

## 技術スタック
- **Runtime**: Node.js (tsx)
- **Database**: SQLite + sqlite-vec
- **ORM**: Drizzle
- **Embeddings**: OpenAI text-embedding-3-small

## プロジェクト構造
```
ottflix/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── drizzle.config.ts
│
├── src/
│   ├── db/
│   │   ├── index.ts           # DB接続
│   │   ├── schema.ts          # テーブル定義
│   │   └── migrate.ts         # マイグレーション実行
│   │
│   ├── services/
│   │   ├── tmdb.ts            # TMDb APIクライアント
│   │   └── embeddings.ts      # OpenAI Embeddings
│   │
│   └── scripts/
│       ├── fetch-movies.ts    # TMDbから取得
│       ├── seed-movies.ts     # DBに保存
│       └── generate-embeddings.ts  # 埋め込み生成
│
├── data/
│   ├── ottflix.db             # SQLiteデータベース
│   └── movies.json            # 取得した映画データ
│
└── .env
```

## 環境変数 (.env)
```env
DATABASE_PATH=data/ottflix.db
TMDB_API_KEY=your_tmdb_api_key
TMDB_ACCESS_TOKEN=your_tmdb_access_token
OPENAI_API_KEY=your_openai_api_key
```

## 実行手順
```bash
# 1. 依存インストール
pnpm install

# 2. マイグレーション
pnpm db:migrate

# 3. TMDbからデータ取得
pnpm fetch:movies

# 4. DBに投入
pnpm seed:movies

# 5. 埋め込み生成 (OpenAI APIキーが必要)
pnpm generate:embeddings
```

## package.json scripts
```json
{
  "scripts": {
    "db:migrate": "tsx src/db/migrate.ts",
    "fetch:movies": "tsx src/scripts/fetch-movies.ts",
    "seed:movies": "tsx src/scripts/seed-movies.ts",
    "generate:embeddings": "tsx src/scripts/generate-embeddings.ts"
  }
}
```

## データベーススキーマ

### movies テーブル
```sql
CREATE TABLE movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER UNIQUE NOT NULL,
  title TEXT NOT NULL,
  title_ja TEXT,
  overview TEXT,
  overview_ja TEXT,
  genres TEXT,  -- JSON array
  release_date TEXT,
  runtime INTEGER,
  popularity REAL,
  vote_average REAL,
  poster_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### movie_embeddings テーブル (sqlite-vec)
```sql
CREATE VIRTUAL TABLE movie_embeddings USING vec0(
  movie_id INTEGER PRIMARY KEY,
  embedding float[1536]
);
```

## 確認ポイント

### データ取得確認
```sql
SELECT COUNT(*) FROM movies;
-- 期待: 1000

SELECT id, title, title_ja, genres
FROM movies
LIMIT 5;
```

### 埋め込み確認
```sql
SELECT COUNT(*) FROM movie_embeddings;
-- 期待: 1000
```

### 簡易類似検索テスト
```sql
-- 特定の映画に似た映画を検索
SELECT m.title, m.title_ja, e.distance
FROM movie_embeddings e
JOIN movies m ON m.id = e.movie_id
WHERE e.embedding MATCH (
  SELECT embedding FROM movie_embeddings WHERE movie_id = 1
)
ORDER BY e.distance
LIMIT 5;
```

## 注意事項

- TMDb APIは1秒あたり40リクエストまで（レートリミット）
- OpenAI Embeddings APIは1分あたり3000リクエストまで
- 埋め込み生成は全件で約$0.02程度（text-embedding-3-small）
