/**
 * Sheet-verified faculty roster for DEPARTMENT directory pages.
 *
 * data/department-sheet-roster.json lists, per department, the faculty ids
 * that appear in the official department sheet
 * (tech-ambit-explorer/sheets/faculty_iitd_departments.xlsx). The Departments
 * tab and department detail pages show only these faculty; the "All" tab and
 * schools/centres pages are not filtered, so every DB faculty stays reachable.
 *
 * This is a read-side filter only — the DB is never modified.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const ROSTER_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../data/department-sheet-roster.json"
);

let rosterByDepartmentId = null;

function loadRoster() {
    if (rosterByDepartmentId) return rosterByDepartmentId;
    rosterByDepartmentId = new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(ROSTER_PATH, "utf-8"));
        for (const entry of Object.values(raw.departments ?? {})) {
            rosterByDepartmentId.set(
                String(entry.departmentId),
                entry.facultyIds.map((id) => new mongoose.Types.ObjectId(id))
            );
        }
    } catch {
        // Missing/invalid roster file: fall back to unfiltered department pages.
    }
    return rosterByDepartmentId;
}

/** Roster faculty ObjectIds for a department, or null when unrestricted. */
export function getDepartmentRosterIds(departmentId) {
    return loadRoster().get(String(departmentId)) ?? null;
}

/**
 * $match stage for the grouped-departments pipeline (placed after the
 * department unwind): keep a faculty row only if its unit has no roster or
 * the faculty is on that unit's roster.
 */
export function buildDepartmentRosterMatchStage() {
    const roster = loadRoster();
    if (roster.size === 0) return null;
    return {
        $match: {
            $and: [...roster.entries()].map(([departmentId, facultyIds]) => ({
                $or: [
                    { "department._id": { $ne: new mongoose.Types.ObjectId(departmentId) } },
                    { _id: { $in: facultyIds } }
                ]
            }))
        }
    };
}
