/**
 * Mongoose data-access layer for directory reads (Faculty / Department /
 * research_scopus). Keeps query details out of the application services,
 * mirroring kgRepository for the knowledge-graph path.
 */
import mongoose from "mongoose";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";
import research_scopus from "../models/research_scopus.js";
import { escapeRegex } from "../domain/facultyDirectory.js";

export function resolveFacultyByKerberos(kerberos) {
    const escaped = escapeRegex(kerberos);
    return Faculty.findOne({ email: new RegExp("^" + escaped + "@", "i") }).lean();
}

export function findFacultyById(id) {
    return Faculty.findById(id).lean();
}

export function findFacultyByScopusId(scopusId) {
    return Faculty.findOne({ scopus_id: scopusId }).lean();
}

export function findFacultiesByScopusIds(ids) {
    return Faculty.find({ scopus_id: { $in: ids } }).lean();
}

export function findFacultiesByKerberosIds(ids) {
    return Faculty.find({
        email: { $in: ids.map((k) => new RegExp("^" + escapeRegex(k) + "@", "i")) }
    }).lean();
}

export function findDepartmentById(id, projection) {
    return Department.findById(id, projection).lean();
}

export function findDepartmentsByCategory(category, projection = "_id code") {
    return Department.find({ category }, projection).lean();
}

export function findDepartmentsByIds(ids, projection = "name code category") {
    return Department.find({ _id: { $in: ids } }, projection).lean();
}

export function findDepartmentsByNameRegex(regex, limit = 5) {
    return Department.find({ name: regex }, { name: 1, code: 1, category: 1 }).limit(limit);
}

export function countFaculties(filter = {}) {
    return Faculty.countDocuments(filter);
}

export function aggregateFaculties(pipeline) {
    return Faculty.aggregate(pipeline);
}

export function groupFacultyCountsByDepartment() {
    return Faculty.aggregate([
        { $group: { _id: "$department", totalFaculty: { $sum: 1 } } }
    ]);
}

export function toObjectId(id) {
    return new mongoose.Types.ObjectId(String(id));
}

export function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(String(id));
}

export function buildPapersMatch(kerberos, scopusIds) {
    const clauses = [];
    if (kerberos) clauses.push({ kerberos });
    if (scopusIds.length) clauses.push({ "authors.author_id": { $in: scopusIds } });
    if (!clauses.length) return { document_eid: { $in: [] } };
    return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

export function aggregateResearch(pipeline) {
    return research_scopus.aggregate(pipeline);
}

export function countResearchDocuments(filter) {
    return research_scopus.countDocuments(filter);
}
