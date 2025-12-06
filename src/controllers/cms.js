import Content from "../models/contents.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import { BadRequestError } from "../utils/errors/BadRequestError.js";
import { NotFoundError } from "../utils/errors/NotFoundError.js";
import { InternalServerError } from "../utils/errors/InternalServerError.js";
import { ValidationError } from "../utils/errors/ValidationError.js";
import { successResponse } from "../utils/response.js";

let cms = {};

cms.getAllContent = asyncErrorHandler(async (req, res) => {
    const content = await Content.find();
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    return successResponse(res, content, "Content fetched successfully", 200);
});

cms.addContent = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    const { title, subtitle, hero_img, body, est_read_time } = req.body;
    const errors = [];
    if (!title) {
        errors.push({
            field: 'title',
            message: 'Title is required'
        })
    }
    if (!subtitle) {
        errors.push({
            field: 'subtitle',
            message: 'Subtitle is required'
        })
    }
    if (!hero_img) {
        errors.push({
            field: 'hero_img',
            message: 'Hero Image is required'
        })
    }
    if (!body) {
        errors.push({
            field: 'body',
            message: 'Body is required'
        })
    }
    if (!est_read_time) {
        errors.push({
            field: 'est_read_time',
            message: 'Estimated Read Time is required'
        })
    }
    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }
    const content = await Content.create({ title, subtitle, hero_img, body, est_read_time });
    if (!content) {
        throw new InternalServerError("Failed to create content");
    }
    return successResponse(res, content, "Content created successfully", 201);
});

cms.editContent = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    const { id, title, subtitle, hero_img, body, est_read_time } = req.body;
    const content = await Content.findById(id);
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    if (req.user.id !== content.created_by || req.user.role !== "admin") {
        throw new UnauthorizedError("You are not authorized to edit this content");
    }
    content.title = title;
    content.subtitle = subtitle;
    content.hero_img = hero_img;
    content.body = body;
    content.est_read_time = est_read_time;
    await content.save();
    return successResponse(res, content, "Content updated successfully", 200);
});

cms.deleteContent = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    const { id } = req.body;
    const content = await Content.findById(id);
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    if (req.user.id !== content.created_by || req.user.role !== "admin") {
        throw new UnauthorizedError("You are not authorized to delete this content");
    }
    await content.remove();
    return successResponse(res, content, "Content deleted successfully", 200);
});





export default cms;