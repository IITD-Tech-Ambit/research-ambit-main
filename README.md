# Research Ambit — Backend API

Express.js backend for Research Ambit at IIT Delhi. It serves the faculty directory, CMS, Atlas, and user feedback APIs consumed by the [Research Ambit portal](https://researchambit.iitd.ac.in/) ([tech-ambit-explorer](https://github.com/IITD-Tech-Ambit/tech-ambit-explorer)).

**API reference:** [Postman documentation](https://documenter.getpostman.com/view/32690520/2sB3dPTWfN)

## System design

This process is the Research Ambit backend for the faculty directory, CMS content, CMS users, suggestions, and the knowledge graph (Atlas). Express and one gRPC server call the same service modules.

```
                         api-gateway (Envoy)
                        /                    \
   Express HTTP :3002                         gRPC directory.v1 :50055
   every worker                               lead worker; insecure creds
                        \                    /
                    directory, kg, content, user, suggestion services
              MongoDB          Redis          Cloudinary
```

HTTP listens on `PORT` (default 3002). `/api` mounts `/directory`, `/kg`, `/content`, `/user`, and `/suggestions`. JSON and urlencoded bodies are limited to 50 MB. gRPC loads `protos/directory/v1/directory.proto` and registers `DirectoryService`, `KnowledgeGraphService`, `ContentService`, `UserService`, and `SuggestionService` on one listener (`GRPC_BIND_ADDRESS`, default `0.0.0.0:50055`). It starts when `GRPC_ENABLED` is not `false`, and only on the lead worker (`NODE_APP_INSTANCE` unset or `0`): the port is a single Envoy contract, and grpc-js does not share it across workers. `GRPC_ENABLED=false` leaves the process REST-only. The listener uses insecure credentials; Envoy is the mesh front.

`grpc.max_receive_message_length` is 8 MB (`8 * 1024 * 1024`). That size fits one 5 MB image plus protobuf overhead. User, content, and suggestion uploads are the paths that travel as protobuf bytes, and their multer limits stay at 5 MB. On that path the bytes are written to a temp file and uploaded with the same Cloudinary helper as REST. The faculty photo route is HTTP-only, with its own 8 MB multer limit (see [Faculty self-service](#faculty-self-service-directory-profile)).

### Trust

`x-user-*` is caller identity only when `isFromGateway` accepts the request. With `GATEWAY_SHARED_SECRET` set, `x-gateway-secret` must match it (equal length, `crypto.timingSafeEqual`). With the secret unset, the check returns true so local development can send the headers; production startup warns in that case.

Directory profile edits do not use the CMS JWT. `denyProfileEdit` returns 401 when `isFromGateway` fails. `x-user-role: superadmin` may edit any kerberos, including when `x-user-kerberos` is absent (non-GET edits are logged). Every other caller must send `x-user-kerberos` equal to the path `:kerberos`: missing is 401, a mismatch is 403.

CMS login and content writes use a separate Bearer JWT. The process exits on startup unless `JWT_SECRET` is at least 32 characters. Sign and verify are pinned to HS256: login signs `{ id, email, role }` with `expiresIn: "1h"`, and verify passes `algorithms: ["HS256"]`. Express `authMiddleware` and gRPC `requireAuth` both call `verifyCmsJwt`. gRPC reads the `authorization` metadata key. CMS `User.role` is `user` or `admin`. `superadmin` is a gateway header on directory profile edits, not a CMS role.

`directory.v1` has no `metricVisibility` field, and citation and h-index counts are `int32`, so a redacted `null` becomes `0` on that path. Image, visibility, and profile-extras edits are Express routes only. Metric-bearing directory reads stay on HTTP for the same reason; see [Faculty self-service](#faculty-self-service-directory-profile).

### Domain areas

**Directory.** Browse, search, department grouping, Scopus and Kerberos lookup, profile, research summary, and publications. A faculty member, or a superadmin, can replace the profile photo (`POST /api/directory/faculty/:kerberos/image`, multipart image, ≤8 MB). The file goes to Cloudinary folder `faculty_images` and the URL is stored as `profile_image_url`. `metric_visibility` covers `h_index`, `citations`, `papers`, and `patents` (default visible). A hidden metric is returned as `null`; the stored number is kept. Profile extras (background, qualifications, awards, custom research areas, additional emails, phone, office address, external links) are readable and writable on the same owner-or-superadmin check. Hidden section text stays in MongoDB and is omitted from the public profile. Those writes delete the directory Redis prefix.

**Publications.** Publication lists and research summaries read `ResearchMetaDataScopus` (collection `researchmetadatascopus`), matched on Scopus author id or kerberos. Faculty with no Scopus id can fall back to Google Scholar records written into that same collection. `patents` is a visibility flag on the faculty document. This service has no patents collection or patents list endpoint.

**CMS.** `Content` documents (markdown body, status `pending` / `archived` / `online`) with hero images in Cloudinary folder `posts`. Likes and comments live on `Analytics`. Create, update, delete, and status changes require a CMS JWT (`admin` or `user`). Hero uploads are ≤5 MB.

**Users.** CMS register, login, edit, and delete. Profile images go to Cloudinary folder `users` (≤5 MB). Register and delete require role `admin`.

**Suggestions.** Feedback submissions, with an optional screenshot (JPEG, PNG, GIF, or WebP, ≤5 MB) stored in Cloudinary folder `research-ambit/suggestions`.

**Knowledge graph.** Atlas octree tiles, per-faculty graphs, topic explorer, and atlas search are read from MongoDB. Small JSON responses are cached in Redis. Hot binary tiles sit in an in-process LRU (`KG_TILE_LRU_MAX`, default 512). The live build is the `atlas_meta` active pointer, cached for about 30 seconds (`KG_ACTIVE_TTL_MS`).

### Data stores

This process connects to MongoDB, Redis, and Cloudinary. Hybrid search is the sibling `/search/*` service. Publication documents carry `open_search_id` (and a kerberos stamp) written outside this process; this backend does not query OpenSearch.

| Store | What it holds |
|-------|----------------|
| MongoDB (`MONGODB_URI`) | Faculty (`faculties`) and departments; Scopus and Scholar publication documents (`researchmetadatascopus`); CMS users, content, and like/comment analytics; suggestions; Atlas collections `atlas_tiles`, `atlas_meta`, `atlas_points`, `kg_faculty_graphs`, `kg_explore`, `kg_indices`; `profile_update_notices` (queued profile-edit notices) |
| Redis (`REDIS_URL`, optional) | Fail-open cache. Directory responses use prefix `dir:v3` (TTL `FACULTY_CACHE_TTL_S`, default 10800 s; search keys 300 s). KG JSON uses `KG_CACHE_TTL_S` (default 10800 s). A down Redis skips the cache. |
| Cloudinary | Faculty photos, CMS user images, content hero images, suggestion screenshots. MongoDB stores the URLs. |

## Role in the Research Ambit stack

Research Ambit is a multi-service platform for discovering IIT Delhi research. This repo is the directory, CMS, and Atlas backend. The browser does not call it directly. The API gateway proxies the faculty self-edit routes and the directory reads that must keep metric visibility over HTTP, and transcodes the rest of `/api/directory`, `/api/kg`, `/api/content`, `/api/user`, and `/api/suggestions` to `directory.v1` through Envoy. Search and chat are separate services.

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
- **Deployment:** Docker + PM2 cluster (`Dockerfile`, `ecosystem.config.cjs`). Coolify runs the container on the VM network; the API gateway is the public ingress.

## Faculty self-service (Directory profile)

Logged-in faculty can edit **their own** Directory profile. A gateway
`x-user-role` of `superadmin` can edit any profile. These routes accept
`x-user-*` only when `isFromGateway` passes (`x-gateway-secret` matches
`GATEWAY_SHARED_SECRET` when that secret is set). A non-superadmin caller
must also have `x-user-kerberos` equal to the path `:kerberos`.

| Route | Purpose |
|---|---|
| `POST /api/directory/faculty/:kerberos/image` | Replace the profile photo (multipart, ≤8 MB, image only). Uploads to Cloudinary (`faculty_images`), sets `profile_image_url`. |
| `PATCH /api/directory/faculty/:kerberos/visibility` | Show/hide the four metrics — `h_index`, `citations`, `papers`, `patents`. JSON body of booleans. |
| `GET /api/directory/faculty/:kerberos/profile-extras` | Owner or superadmin. Returns the **full** Background / Qualifications (incl. hidden content) for the edit view. |
| `PATCH /api/directory/faculty/:kerberos/profile-extras` | Save Background / Qualifications + their visibility. Body: `{ background, qualifications[], background_visible, qualifications_visible }`. |

**Background & Qualifications.** Two optional, **profile-only** sections
(`background` string, `qualifications` string[]) with per-section visibility
(`background_visible` / `qualifications_visible`, both default **`false`** →
hidden). Unlike metrics, these are added **only in the profile response**
(`getFacultyByKerberos`), *not* in `formatDirectoryFaculty`, so they never leak
into search/listings. Content is **kept in the DB even when hidden** (so it can be
shown again) and is **redacted to `null`** on the public profile read when hidden;
the owner's edit view loads the full content through the authenticated
`GET …/profile-extras` instead. Validation is enforced **only when a section is
shown**: background ≥ 100 characters, ≥ 1 qualification. Writes flush the directory
cache. Exposed to the frontend as `backgroundVisible` / `qualificationsVisible`
(+ `background` / `qualifications`, `null` when hidden).

**Metric visibility.** Each faculty doc carries `metric_visibility` (all default
`true`). A hidden metric is **redacted to `null`** in the central
`formatDirectoryFaculty` (so profile, search *and* listings hide it) and in the
research-summary path — the value is **never deleted**, only flagged, so it can be
shown again. The flags are exposed as `metricVisibility` for the frontend's edit
toggles. Every write **flushes the directory cache** (`cacheDelByPrefix`) so the
change takes effect everywhere immediately.

> ⚠️ **Gateway routing (do not revert):** `/api/directory` is served over
> **directory.v1 gRPC** through Envoy, whose proto has **no `metricVisibility`
> field** and turns a redacted `null` metric into `0`. So the metric-bearing
> directory **reads** (`profile`, `research-summary`, `search`, flat list,
> `grouped/:id/faculties`) are deliberately **HTTP-proxied** in
> `api-gateway/src/routes/proxy.js` — the response envelope is identical, but this
> is what lets the visibility flags + `null` redaction reach the browser. Routing
> these back through gRPC will silently break metric hiding. Any *new* profile
> field faces the same constraint.

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
| `MONGODB_URI` | Yes | MongoDB connection string (Mongoose). Atlas publish commands in [Atlas data](#atlas-data-mongodb) pass `MONGO_URI` to the Python pipeline. |
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
