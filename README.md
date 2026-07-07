# Research Ambit — Backend API

Express.js backend for [Research Ambit](https://iitd-dev.vercel.app) at IIT Delhi. It serves the faculty directory, CMS, knowledge-graph explorer, research atlas, and user feedback APIs consumed by the [tech-ambit-explorer](https://github.com/IITD-Tech-Ambit/tech-ambit-explorer) frontend.

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
| Knowledge graph | `/api/kg` | Per-faculty graphs, topic explorer, research atlas search and cluster breakdown |
| CMS | `/api/content` | Articles and announcements with likes, comments, and moderation |
| Users | `/api/user` | Registration, login (JWT), profile management |
| Suggestions | `/api/suggestions` | User feedback submissions with optional screenshots |

Knowledge-graph JSON is generated offline by `knowledge-graph/pipeline/build_kg.py` from classified Scopus papers and MongoDB metadata, then served from `data/knowledge-graph/` (or `KG_DATA_DIR`).

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
- Python 3 (only if rebuilding knowledge-graph data)

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
- `GET /api/kg/health` — knowledge-graph data availability

## Related repositories

| Repository | Role |
|------------|------|
| [tech-ambit-explorer](https://github.com/IITD-Tech-Ambit/tech-ambit-explorer) | React frontend |
| [SEO-Backend-iitd](https://github.com/IITD-Tech-Ambit/SEO-Backend-iitd) | Hybrid search API |
| [chatbot-agent](https://github.com/IITD-Tech-Ambit/chatbot-agent) | RAG chatbot service |
| [classification-pipeline](https://github.com/IITD-Tech-Ambit/classification-pipeline) | Paper classification docs and planning |

## License

ISC
