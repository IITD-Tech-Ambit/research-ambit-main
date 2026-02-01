import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import { BadRequestError } from "../lib/customErrors.js";
import Faculty from "../models/faculty.js";
import research_scopus from "../models/research_scopus.js";
import phd_thesis from "../models/phd_thesis.js";

let directory = {};

directory.getAllFaculties = asyncErrorHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 9));
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || "hIndex";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    const sortFields = {
        name: "name",
        hIndex: "hIndex"
    };
    const sortField = sortFields[sortBy] || "hIndex";

    const pipeline = [
        {
            $lookup: {
                from: "departments",
                localField: "department",
                foreignField: "_id",
                as: "department"
            }
        },
        { $unwind: "$department" },
        { $sort: { [sortField]: sortOrder } },
        { $skip: skip },
        { $limit: limit },
        {
            $project: {
                name: 1,
                email: 1,
                citationCount: 1,
                hIndex: 1,
                research_areas: 1,
                orcId: 1,
                scopusId: 1,
                "department._id": 1,
                "department.name": 1,
                "department.code": 1
            }
        }
    ];

    const [faculties, countResult] = await Promise.all([
        Faculty.aggregate(pipeline),
        Faculty.countDocuments()
    ]);

    const totalPages = Math.ceil(countResult / limit);

    return successResponse(res, {
        data: faculties,
        pagination: {
            page,
            limit,
            total: countResult,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        }
    }, "Faculties fetched successfully", 200);
});

directory.getFacultiesById = asyncErrorHandler(async (req, res) => {
    const { id } = req.params;
    if (!id) {
        throw new BadRequestError("No id provided");
    }
    const faculty = await Faculty.findById(id).populate("department", "name");
    return successResponse(res, faculty, "Faculty fetched successfully", 200);
});

directory.getFacultyCoworking = asyncErrorHandler(async (req, res) => {
    const { id } = req.params;
    if (!id) {
        throw new BadRequestError("No id provided");
    }
    const faculty = await Faculty.findById(id);
    if (!faculty) {
        throw new BadRequestError("Faculty not found");
    }
    const papersWithFaculty = await research_scopus.find({
        "authors.matched_profile": faculty._id
    });
    const coworkersFromScopus = new Map();
    papersWithFaculty.forEach(paper => {
        paper.authors.forEach(author => {
            if (author.matched_profile?.toString() !== faculty._id.toString()) {
                if (!coworkersFromScopus.has(author.author_id)) {
                    coworkersFromScopus.set(author.author_id, {
                        title: paper.title,
                        publication_year: paper.publication_year,
                        document_type: paper.document_type,
                        subject_area: paper.subject_area,
                        name: author.author_name,
                        affiliation: author.author_affiliation || "Unknown",
                        author_id: author.author_id,
                        matched_profile: author.matched_profile || null
                    });
                }
            }
        });
    });
    const thesesWithFaculty = await phd_thesis.find({
        "contributor.advisor.matched_profile": faculty._id
    });
    const studentsFromThesis = thesesWithFaculty.map(thesis => ({
        name: thesis.contributor.author,
        affiliation: "IIT Delhi",
        thesis_title: thesis.title,
        year: thesis.publication_year
    }));
    return successResponse(res, {
        faculty: {
            name: faculty.name,
            _id: faculty._id
        },
        hIndex: faculty.hIndex,
        citationCount: faculty.citationCount,
        scopusId: faculty.scopusId,
        coworkersFromPapers: Array.from(coworkersFromScopus.values()),
        studentsSupervised: studentsFromThesis,
        stats: {
            totalPapers: papersWithFaculty.length,
            uniqueCoauthors: coworkersFromScopus.size,
            totalStudentsSupervised: studentsFromThesis.length
        }
    }, "Coworkers fetched successfully", 200);
});




export default directory;
