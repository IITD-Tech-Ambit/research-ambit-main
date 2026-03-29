import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import { BadRequestError } from "../lib/customErrors.js";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";
import research_scopus from "../models/research_scopus.js";
import phd_thesis from "../models/phd_thesis.js";

let directory = {};

directory.getAllFaculties = asyncErrorHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 9));
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || "h_index";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    const sortFields = {
        name: "firstName",
        h_index: "h_index"
    };
    const sortField = sortFields[sortBy] || "h_index";

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
                firstName: 1,
                lastName: 1,
                email: 1,
                citation_count: 1,
                h_index: 1,
                expertise: 1,
                orcid_id: 1,
                scopus_id: 1,
                profile_image_url: 1,
                "department._id": 1,
                "department.name": 1,
                "department.code": 1
            }
        }
    ];

    const [faculties, total] = await Promise.all([
        Faculty.aggregate(pipeline),
        Faculty.countDocuments()
    ]);

    const totalPages = Math.ceil(total / limit);

    return successResponse(res, {
        data: faculties,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        }
    }, "Faculties fetched successfully", 200);
});

directory.getFacultiesGroupedByDepartment = asyncErrorHandler(async (req, res) => {
    const category = req.query.category; // 'departments', 'schools', 'centres', 'researchlabs'

    // Map frontend category values to database category values
    const categoryMap = {
        departments: "Department",
        schools: "School",
        centres: "Centre",
        researchlabs: "Research Lab / Facility"
    };

    const matchStage = category && categoryMap[category]
        ? { "department.category": categoryMap[category] }
        : {};

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
        // Filter by category
        ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
        // Sort by h_index descending within each group
        { $sort: { "department.name": 1, h_index: -1 } },
        // Group by department
        {
            $group: {
                _id: "$department._id",
                departmentName: { $first: "$department.name" },
                departmentCode: { $first: "$department.code" },
                departmentCategory: { $first: "$department.category" },
                faculties: {
                    $push: {
                        _id: "$_id",
                        firstName: "$firstName",
                        lastName: "$lastName",
                        email: "$email",
                        citation_count: "$citation_count",
                        h_index: "$h_index",
                        expertise: "$expertise",
                        orcid_id: "$orcid_id",
                        scopus_id: "$scopus_id",
                        profile_image_url: "$profile_image_url"
                    }
                },
                totalFaculty: { $sum: 1 },
                avgHIndex: { $avg: "$h_index" }
            }
        },
        // Sort departments by name
        { $sort: { departmentName: 1 } },
        // Project final shape
        {
            $project: {
                _id: 1,
                department: {
                    _id: "$_id",
                    name: "$departmentName",
                    code: "$departmentCode",
                    category: "$departmentCategory"
                },
                faculties: 1,
                stats: {
                    totalFaculty: "$totalFaculty",
                    avgHIndex: { $round: ["$avgHIndex", 1] }
                }
            }
        }
    ];

    const groupedData = await Faculty.aggregate(pipeline);

    return successResponse(res, {
        departments: groupedData,
        totalDepartments: groupedData.length,
        totalFaculty: groupedData.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
    }, "Grouped faculties fetched successfully", 200);
});

directory.searchFaculties = asyncErrorHandler(async (req, res) => {
    const { q } = req.query;
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    if (!q || q.trim().length < 2) {
        return successResponse(res, {
            faculties: [],
            departments: [],
            total: 0
        }, "Search query too short", 200);
    }

    const searchTerm = q.trim();
    const regexPattern = new RegExp(searchTerm, 'i');

    // Search faculties by name (using regex for partial match)
    const facultyPromise = Faculty.aggregate([
        {
            $lookup: {
                from: "departments",
                localField: "department",
                foreignField: "_id",
                as: "department"
            }
        },
        { $unwind: "$department" },
        {
            $match: {
                $or: [
                    { firstName: regexPattern },
                    { lastName: regexPattern },
                    { "department.name": regexPattern }
                ]
            }
        },
        { $sort: { h_index: -1 } },
        { $limit: limit },
        {
            $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                email: 1,
                h_index: 1,
                citation_count: 1,
                expertise: 1,
                profile_image_url: 1,
                "department._id": 1,
                "department.name": 1,
                "department.code": 1
            }
        }
    ]);

    // Search departments by name
    const departmentPromise = Department.find(
        { name: regexPattern },
        { name: 1, code: 1, category: 1 }
    ).limit(5);

    const [faculties, departments] = await Promise.all([facultyPromise, departmentPromise]);

    return successResponse(res, {
        faculties,
        departments,
        total: faculties.length + departments.length
    }, "Search completed", 200);
});

directory.getFacultiesById = asyncErrorHandler(async (req, res) => {
    const { id } = req.params;
    if (!id) {
        throw new BadRequestError("No id provided");
    }
    const faculty = await Faculty.findById(id).populate("department", "name category");
    // attach tags based on department category
    const tags = ["all"];
    if (faculty?.department?.category) {
        const cat = faculty.department.category;
        if (cat === "Department") tags.push("departments");
        else if (cat === "Research Lab / Facility") tags.push("researchlabs");
        else if (cat === "Centre") tags.push("centres");
        else if (cat === "School") tags.push("schools");
    }
    const facultyResponse = Object.assign({}, faculty?.toObject ? faculty.toObject() : faculty, { tags });
    return successResponse(res, facultyResponse, "Faculty fetched successfully", 200);
});

directory.getFacultyCoworking = asyncErrorHandler(async (req, res) => {
    const { id } = req.params;
    if (!id) {
        throw new BadRequestError("No id provided");
    }
    const faculty = await Faculty.findById(id).populate("department", "name category");
    if (!faculty) {
        throw new BadRequestError("Faculty not found");
    }
    const papersWithFaculty = await research_scopus.find({
        expert_id: faculty.expert_id
    });
    const coworkersFromScopus = new Map();
    papersWithFaculty.forEach(paper => {
        paper.authors.forEach(author => {
            if (!coworkersFromScopus.has(author.author_id)) {
                coworkersFromScopus.set(author.author_id, {
                    title: paper.title,
                    publication_year: paper.publication_year,
                    document_type: paper.document_type,
                    subject_area: paper.subject_area,
                    name: author.author_name,
                    author_id: author.author_id,
                });
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
    // derive tags for the faculty
    const tagsCowork = ["all"];
    if (faculty?.department?.category) {
        const cat = faculty.department.category;
        if (cat === "Department") tagsCowork.push("departments");
        else if (cat === "Research Lab / Facility") tagsCowork.push("researchlabs");
        else if (cat === "Centre") tagsCowork.push("centres");
        else if (cat === "School") tagsCowork.push("schools");
    }

    return successResponse(res, {
        faculty: {
            firstName: faculty.firstName,
            lastName: faculty.lastName,
            _id: faculty._id,
            tags: tagsCowork
        },
        h_index: faculty.h_index,
        citation_count: faculty.citation_count,
        scopus_id: faculty.scopus_id,
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
