# OTTflix - AI映画検索サービス

## Claude向け指示
- セッション開始時に `pnpm dev` をバックグラウンドで実行して開発サーバーを起動すること

## 概要
Netflix風UIのAI映画検索サービス。セマンティック検索とパーソナライズ推薦機能を搭載。

## 技術スタック
- **Runtime**: Node.js + tsx
- **Framework**: Hono
- **Database**: SQLite + sqlite-vec (ベクトル検索)
- **Embeddings**: OpenAI text-embedding-3-small
- **Deploy**: Railway

## 主要機能
- AI検索（セマンティック検索）: 自然言語で映画を検索
- ジャンルタグフィルター: ワンクリックでジャンル絞り込み
- 映画詳細: キャスト、予告編、レビュー、配信サービス情報
- パーソナライズ推薦: Netflix視聴履歴をアップロードしてあなた好みの映画を推薦

## プロジェクト構造
```
ottflix/
├── CLAUDE.md
├── package.json
├── railway.toml
├── src/
│   ├── server.ts              # メインサーバー (Hono)
│   ├── db/
│   │   ├── index.ts           # DB接続
│   │   ├── schema.ts          # テーブル定義
│   │   └── migrate.ts         # マイグレーション
│   ├── services/
│   │   ├── tmdb.ts            # TMDb APIクライアント
│   │   ├── embeddings.ts      # OpenAI Embeddings
│   │   └── personalization.ts # パーソナライズ機能
│   └── scripts/
│       ├── fetch-movies.ts    # TMDbから映画取得
│       ├── fetch-providers.ts # 配信サービス取得
│       ├── fetch-extended-data.ts # 詳細データ取得
│       ├── seed-movies.ts     # DBに保存
│       └── generate-embeddings.ts # 埋め込み生成
├── public/
│   └── index.html             # フロントエンド (SPA)
├── data/
│   └── ottflix.db             # SQLiteデータベース
└── .env
```

## 環境変数 (.env)
```env
DATABASE_PATH=data/ottflix.db
TMDB_API_KEY=your_tmdb_api_key
TMDB_ACCESS_TOKEN=your_tmdb_access_token
OPENAI_API_KEY=your_openai_api_key
PORT=3000
```

## 開発コマンド
```bash
# 開発サーバー起動
pnpm dev

# データ取得・更新
pnpm fetch:movies        # TMDbから映画取得
pnpm seed:movies         # DBに保存
pnpm fetch:providers     # 配信サービス情報取得
pnpm fetch:extended      # 詳細データ取得
pnpm generate:embeddings # 埋め込み生成

# DB操作
pnpm db:migrate          # マイグレーション実行
```

## API エンドポイント

### 映画
- `GET /api/movies` - 映画一覧 (pagination, search, genre対応)
- `GET /api/movies/:id` - 映画詳細
- `GET /api/movies/:id/full` - 全情報 (credits, videos, reviews含む)
- `GET /api/movies/:id/similar` - AI類似映画
- `GET /api/movies/:id/providers` - 配信サービス
- `GET /api/movies/:id/credits` - キャスト・スタッフ
- `GET /api/movies/:id/videos` - 予告編
- `GET /api/movies/:id/reviews` - レビュー

### 検索
- `GET /api/search?q=...` - AI検索 (セマンティック検索)
- `GET /api/genres` - ジャンル一覧

### パーソナライズ
- `POST /api/history/upload` - Netflix履歴アップロード
- `GET /api/recommendations/:sessionId` - パーソナライズ推薦
- `DELETE /api/history/:sessionId` - 履歴削除

## デプロイ
```bash
# Railwayにデプロイ
railway up
```

本番URL: https://ottflix-production.up.railway.app
