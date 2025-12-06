import Content from "../models/contents.js";
import Analytics from "../models/analytics.js";
import { asyncErrorHandler } from "../middleware/errorHandler.js";
import {
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
    InternalServerError,
} from "../lib/customErrors.js";
import { successResponse } from "../lib/responseUtils.js";

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
    if (!title) errors.push({ field: "title", message: "Title is required" });
    if (!subtitle)
        errors.push({ field: "subtitle", message: "Subtitle is required" });
    if (!hero_img)
        errors.push({ field: "hero_img", message: "Hero Image is required" });
    if (!body) errors.push({ field: "body", message: "Body is required" });
    if (!est_read_time)
        errors.push({
            field: "est_read_time",
            message: "Estimated Read Time is required",
        });

    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }

    const content = await Content.create({
        title,
        subtitle,
        hero_img,
        body,
        est_read_time,
        created_by: req.user.id,
    });

    if (!content) {
        throw new InternalServerError("Failed to create content");
    }

    // Initialize Analytics for the new content
    await Analytics.create({ content: content._id });

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
    if (
        content.created_by.toString() !== req.user.id &&
        req.user.role !== "admin"
    ) {
        throw new UnauthorizedError("You are not authorized to edit this content");
    }
    content.title = title || content.title;
    content.subtitle = subtitle || content.subtitle;
    content.hero_img = hero_img || content.hero_img;
    content.body = body || content.body;
    content.est_read_time = est_read_time || content.est_read_time;
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
    if (
        content.created_by.toString() !== req.user.id &&
        req.user.role !== "admin"
    ) {
        throw new UnauthorizedError(
            "You are not authorized to delete this content"
        );
    }
    await content.deleteOne(); // remove() is deprecated
    // Also delete associated analytics
    await Analytics.findOneAndDelete({ content: id });
    return successResponse(res, null, "Content deleted successfully", 200);
});

// Analytics: Likes & Comments

cms.addLikeOnContent = asyncErrorHandler(async (req, res) => {
    const { contentId, isAuth } = req.body;
    const userId = isAuth ? req.user.id : null;
    if (isAuth && !userId) {
        throw new UnauthorizedError("You are not authorized to add like");
    }
    const ipAddress = req.ip;

    if (!contentId) {
        throw new BadRequestError("Content ID is required");
    }

    // Check if user already liked (Authentication limit: per User ID)
    if (userId) {
        const existingLike = await Analytics.findOne({
            content: contentId,
            "likes.user": userId,
        });
        if (existingLike) {
            throw new BadRequestError("You have already liked this content");
        }
    }

    // Upsert ensures we create the analytics doc if it doesn't exist
    // $addToSet ensures unique likes per unique object.
    // Explicitly setting user: null for anon ensures distinct structure from auth likes.
    const query = { content: contentId };
    const likeObj = { ip_address: ipAddress, user: userId || null };

    const analytics = await Analytics.findOneAndUpdate(
        query,
        {
            $addToSet: {
                likes: likeObj,
            },
        },
        { new: true, upsert: true }
    );

    return successResponse(res, analytics, "Like added successfully", 200);
});

cms.removeLikeOnContent = asyncErrorHandler(async (req, res) => {
    const { contentId } = req.body;
    const userId = req.user ? req.user.id : null;
    const ipAddress = req.ip;

    if (!contentId) {
        throw new BadRequestError("Content ID is required");
    }

    const query = { content: contentId };
    // Construct pull query to match user OR ip
    // Use explicit null for anon to match what we stored
    const pullQuery = {};
    if (userId) {
        pullQuery.user = userId;
    } else {
        pullQuery.ip_address = ipAddress;
        pullQuery.user = null;
    }

    const analytics = await Analytics.findOneAndUpdate(
        query,
        {
            $pull: {
                likes: pullQuery,
            },
        },
        { new: true }
    );

    if (!analytics) throw new NotFoundError("Analytics not found");

    return successResponse(res, analytics, "Like removed successfully", 200);
});

cms.addCommentOnContent = asyncErrorHandler(async (req, res) => {
    const { contentId, body, isAuth } = req.body;
    const userId = isAuth ? req.user.id : null;
    if (isAuth && !userId) {
        throw new UnauthorizedError("You are not authorized to add comment");
    }
    const ipAddress = req.ip;

    if (!contentId || !body) {
        throw new BadRequestError("Content ID and comment body are required");
    }

    // Check if user already commented
    // Auth: Check by User ID
    // Anon: Check by IP Address (assuming we want to limit anon spam too)
    const checkQuery = { content: contentId };
    if (userId) {
        checkQuery["comments.created_by"] = userId;
    } else {
        checkQuery["comments.ip_address"] = ipAddress;
        checkQuery["comments.created_by"] = null; // Strict check for anon comments
    }

    const existingComment = await Analytics.findOne(checkQuery);
    if (existingComment) {
        throw new BadRequestError("You have already commented on this content");
    }

    const comment = {
        body,
        ip_address: ipAddress,
        created_by: userId,
    };

    const analytics = await Analytics.findOneAndUpdate(
        { content: contentId },
        {
            $push: {
                comments: comment,
            },
        },
        { new: true, upsert: true }
    );

    return successResponse(
        res,
        analytics.comments[analytics.comments.length - 1],
        "Comment added successfully",
        201
    );
});

cms.deleteCommentOnContent = asyncErrorHandler(async (req, res) => {
    const { contentId, commentId } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!contentId || !commentId) {
        throw new BadRequestError("Content ID and Comment ID are required");
    }

    const analytics = await Analytics.findOne({ content: contentId });
    if (!analytics) throw new NotFoundError("Content Analytics not found");

    const comment = analytics.comments.id(commentId);
    if (!comment) throw new NotFoundError("Comment not found");

    const isAdmin = req.user && req.user.role === "admin";
    const isCreator =
        userId &&
        comment.created_by &&
        comment.created_by.toString() === userId;

    // Authorization: Admin or Comment Creator
    if (!isAdmin && !isCreator) {
        throw new UnauthorizedError("Not authorized to delete this comment");
    }

    comment.deleteOne(); // helper method from mongoose subdoc
    await analytics.save();

    return successResponse(res, null, "Comment deleted successfully", 200);
});

export default cms;