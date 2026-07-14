# Research Ambit — Backend API

Express.js backend for Research Ambit at IIT Delhi. It serves the faculty directory, CMS, Atlas, and user feedback APIs consumed by the [Research Ambit portal](https://researchambit.iitd.ac.in/) ([tech-ambit-explorer](https://github.com/IITD-Tech-Ambit/tech-ambit-explorer)).

**API reference:** [Postman documentation](https://documenter.getpostman.com/view/32690520/2sB3dPTWfN)

## Role in the Research Ambit stack

Research Ambit is a multi-service platform for discovering IIT Delhi research. This repo is the **primary backend** (`/api/*`) behind the public SPA.

```
tech-ambit-explorer (React)     :8080
        │
        ├── /api/*          → research-ambit-main (this repo) :3002
        ├── /search/*       → opensearch (hybrid search)       :3000
        └── /chat-api/*     → chatbot-agent (RAG chatbot)      :3003

Shared data stores: MongoDB · Redis · OpenSearch
```

| Module | Route prefix | Purpose |
|--------|--------------|---------|
| Faculty directory | `/api/directory` | Browse, search, and filter ~1,000+ faculty; profiles, publications, Scopus/Kerberos lookups |
| Atlas | `/api/kg` | Per-faculty graphs, topic explorer, Atlas search and cluster breakdown |
| CMS | `/api/content` | Articles and announcements with likes, comments, and moderation |
| Users | `/api/user` | Registration, login (JWT), profile management |
| Suggestions | `/api/suggestions` | User feedback submissions with optional screenshots |

Atlas data is generated offline by `knowledge-graph/pipeline/build_kg.py` from classified Scopus papers and MongoDB metadata, then **published straight into MongoDB** (octree LOD atlas tiles + faculty graphs + explore/index docs). The runtime no longer reads the filesystem — Atlas streams octree tiles by viewport instead of shipping one ~27 MB JSON. See [Atlas data (MongoDB)](#atlas-data-mongodb).

### Atlas data (MongoDB)

All KG data lives in MongoDB, versioned by an immutable build hash with an `atlas_meta` `active` pointer flipped atomically at the end of a build:

| Collection | Contents |
|------------|----------|
| `atlas_tiles` | one octree node per doc — quantized binary LOD tile (`payload` BinData) |
| `atlas_meta` | per-version headers-only octree tree + taxonomy dict, and the `active` version pointer |
| `atlas_points` | one row per paper: exact coords + searchable title/taxonomy text (server-side atlas search + highlight overlay) |
| `kg_faculty_graphs` | one per-faculty graph per doc |
| `kg_explore` | Topic Explorer term rows + per-key detail docs |
| `kg_indices` | derived lookups: faculty search index, faculty→atlas indices, department→atlas indices |

**One-time / recurring publish** (run from `knowledge-graph/pipeline`, with `MONGO_URI` set to the target — e.g. the VM Mongo):

```bash
# Full rebuild: writes the source JSON, then publishes tiles + all KG data to Mongo
MONGO_URI="mongodb://user:pass@<mongo-host>:27017/research_ambit?authSource=admin" python -u build_kg.py

# Or publish from already-built JSON without a full rebuild:
MONGO_URI="..." python build_atlas_tiles.py      # writes atlas_tiles/atlas_points/atlas_meta, flips active
MONGO_URI="..." python migrate_kg_to_mongo.py    # writes graphs/explore/indices under the active version
```

Old builds are garbage-collected automatically (keeps the current + previous version). The backend picks up the new `active` version within ~30 s (`KG_ACTIVE_TTL_MS`); no redeploy needed.

**Atlas serving:** the frontend streams octree tiles via `GET /api/kg/atlas/tree`, `.../atlas/dict`, `.../atlas/tile/:nodeKey` (raw `application/octet-stream`, immutable + long-cached) and `.../atlas/points?indices=…` (highlight overlay). Server-side search is `GET /api/kg/atlas/search`. The frontend renderer is selected by `VITE_ATLAS_TILES` (default on); the legacy `GET /api/kg/atlas` monolith is retained as a fallback (rebuilt from `atlas_points`) during the migration window.

**Cutover (after verifying the tile renderer against real data):** flip `VITE_ATLAS_TILES` on for all environments, then remove the legacy `getAtlas`/`GetAtlas` path plus the client-side full-text scan and `paperIdToIndex` bloat in `tech-ambit-explorer` (`ResearchAtlas.tsx`, `atlasClusters.ts`). The filesystem data dependency is already dropped: the runtime never reads `data/knowledge-graph/`, and the image excludes it via `.dockerignore`.

## Architecture

- **Runtime:** Node.js 20, ES modules, Express 5
- **Database:** MongoDB (Mongoose) — faculty, departments, Scopus publications, CMS content, users
- **Cache:** Redis for directory and KG API responses (`REDIS_URL`, TTL env vars)
- **Media:** Cloudinary for profile and hero images
- **Observability:** Prometheus metrics per PM2 worker (`METRICS_PORT_BASE`, default 9111+)
- **Deployment:** Docker + PM2 cluster (`Dockerfile`, `ecosystem.config.cjs`); nginx routes `/api/` to port 3002 in the full stack

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [MongoDB](https://www.mongodb.com/) (local or Atlas)
- [Redis](https://redis.io/) (recommended for caching; optional for local dev)
- Python 3 (only if rebuilding Atlas data)

## Setup

```bash
git clone https://github.com/IITD-Tech-Ambit/research-ambit-main.git
cd research-ambit-main
npm install
cp .env.example .env
# Edit .env with your MongoDB URI, JWT secret, Cloudinary keys, and optional Redis/KG paths
npm run dev
```

The server listens on **port 3002** by default (`PORT`).

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Secret for signing auth tokens |
| `CLOUDINARY_*` | Yes | Cloudinary cloud name, API key, and secret |
| `REDIS_URL` | No | Redis URL for response caching |
| `KG_DATA_DIR` | No | Path to generated KG JSON (default: `./data/knowledge-graph`) |
| `KG_CACHE_TTL_S` | No | KG cache TTL in seconds (default: 10800) |
| `FACULTY_CACHE_TTL_S` | No | Directory cache TTL in seconds (default: 10800) |
| `PORT` | No | HTTP port (default: 3002) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon (hot reload) |
| `npm start` | Start production server |
| `npm run lint` | Format with Prettier |
| `npm run lint:check` | Check formatting without writing |

## Health checks

- `GET /` — service health (JSON)
- `GET /health` — lightweight liveness probe
- `GET /api/kg/health` — Atlas data availability

## Related repositories

| Repository | Role |
|------------|------|
| [tech-ambit-explorer](https://github.com/IITD-Tech-Ambit/tech-ambit-explorer) | React frontend |
| [SEO-Backend-iitd](https://github.com/IITD-Tech-Ambit/SEO-Backend-iitd) | Hybrid search API |
| [chatbot-agent](https://github.com/IITD-Tech-Ambit/chatbot-agent) | RAG chatbot service |
| [classification-pipeline](https://github.com/IITD-Tech-Ambit/classification-pipeline) | Paper classification docs and planning |

## License

ISC
