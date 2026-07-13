/**
 * MongoDB models for all Knowledge-Graph data — replaces the on-disk
 * data/knowledge-graph/* files. Everything is versioned by a single build
 * `version` string; the active build is resolved through the `pointer` doc in
 * atlas_meta so reads/writes never race a rebuild.
 *
 * Collections:
 *   atlas_tiles        one octree node payload per doc (quantized binary)
 *   atlas_meta         per-version tree header + taxonomy dict + active pointer
 *   kg_faculty_graphs  one per-faculty knowledge graph per doc
 *   kg_explore         topic-explorer terms + per-key detail docs
 *   kg_indices         derived lookup structures (faculty search index,
 *                      faculty->atlas indices, department->atlas indices)
 */
import mongoose from "mongoose";

const { Schema } = mongoose;

// One octree node. `payload` is the quantized binary tile (see the tiler for
// the layout); kept intentionally small so the 16 MB doc limit never applies.
const atlasTileSchema = new Schema(
  {
    version: { type: String, required: true },
    nodeKey: { type: String, required: true }, // "" = root, else octant path e.g. "3-7-1"
    pointCount: { type: Number, default: 0 },
    payload: { type: Buffer, required: true },
  },
  { collection: "atlas_tiles", versionKey: false },
);
atlasTileSchema.index({ version: 1, nodeKey: 1 }, { unique: true });

// Two doc kinds share this collection, distinguished by `kind`:
//   kind:"pointer" (_id:"active") -> { version } names the live build
//   kind:"version" (_id:<version>) -> { tree, dict, pointCount }
const atlasMetaSchema = new Schema(
  {
    _id: String, // version string, or the literal "active" for the pointer doc
    kind: { type: String, enum: ["pointer", "version"], required: true },
    version: { type: String },
    pointCount: { type: Number },
    // Headers-only octree hierarchy: { root, spacing, bbox:{min,max},
    // nodes:{ key:{ bounds:{min,max}, childMask, pointCount, depth } } }.
    tree: { type: Schema.Types.Mixed },
    // Taxonomy id maps + precomputed label anchors:
    // { themes:[name...], domains:[name...], themeAnchors:[...], domainAnchors:[...] }.
    dict: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "atlas_meta", versionKey: false },
);

const kgFacultyGraphSchema = new Schema(
  {
    version: { type: String, required: true },
    facultyId: { type: String, required: true },
    graph: { type: Schema.Types.Mixed, required: true },
  },
  { collection: "kg_faculty_graphs", versionKey: false },
);
kgFacultyGraphSchema.index({ version: 1, facultyId: 1 }, { unique: true });

// kind:"term"   -> { term, type, ...termFields }        (Topic Explorer list)
// kind:"detail" -> { key, detail }                       (per-node detail)
const kgExploreSchema = new Schema(
  {
    version: { type: String, required: true },
    kind: { type: String, enum: ["term", "detail"], required: true },
    key: { type: String }, // detail lookup key
    term: { type: String }, // term text
    type: { type: String }, // theme | domain | subdomain | topic
    payload: { type: Schema.Types.Mixed }, // full term row or detail object
  },
  { collection: "kg_explore", versionKey: false },
);
kgExploreSchema.index({ version: 1, kind: 1, key: 1 });
kgExploreSchema.index({ version: 1, kind: 1, type: 1 });

// One row per atlas paper: exact float coords (for the highlight overlay of
// points not currently loaded as tiles) + searchable taxonomy/title text. This
// is queried on demand via indexes, never loaded wholesale into app memory,
// which is what makes server-side atlas search scale.
const atlasPointSchema = new Schema(
  {
    version: { type: String, required: true },
    i: { type: Number, required: true }, // global atlas index
    id: { type: String }, // paper _id
    title: { type: String },
    theme: { type: String },
    domain: { type: String },
    subdomain: { type: String },
    topic: { type: String },
    department: { type: String },
    citations: { type: Number, default: 0 },
    x: { type: Number },
    y: { type: Number },
    z: { type: Number },
  },
  { collection: "atlas_points", versionKey: false },
);
atlasPointSchema.index({ version: 1, i: 1 }, { unique: true });
atlasPointSchema.index({ version: 1, theme: 1 });
atlasPointSchema.index(
  { title: "text", theme: "text", domain: "text", subdomain: "text", topic: "text" },
  { name: "atlas_point_text", weights: { title: 5, topic: 4, subdomain: 3, domain: 2, theme: 1 } },
);

// Derived lookup structures, one doc per (version, name). name is one of
// "faculty-search-index" | "faculty-atlas-indices" | "department-atlas-indices".
const kgIndexSchema = new Schema(
  {
    version: { type: String, required: true },
    name: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { collection: "kg_indices", versionKey: false },
);
kgIndexSchema.index({ version: 1, name: 1 }, { unique: true });

export const AtlasTile = mongoose.model("AtlasTile", atlasTileSchema);
export const AtlasMeta = mongoose.model("AtlasMeta", atlasMetaSchema);
export const AtlasPoint = mongoose.model("AtlasPoint", atlasPointSchema);
export const KgFacultyGraph = mongoose.model("KgFacultyGraph", kgFacultyGraphSchema);
export const KgExplore = mongoose.model("KgExplore", kgExploreSchema);
export const KgIndex = mongoose.model("KgIndex", kgIndexSchema);

export const ACTIVE_POINTER_ID = "active";
