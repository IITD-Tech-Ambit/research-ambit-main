import Content from "../models/contents.js";
import Analytics from "../models/analytics.js";
import User from "../models/user.js";
import { asyncErrorHandler } from "../middleware/errorHandler.js";
import {
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
    InternalServerError,
} from "../lib/customErrors.js";
import { successResponse } from "../lib/responseUtils.js";
import { getUserId } from "../lib/userIdExtractor.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary.js";

let cms = {};

cms.getAllContent = asyncErrorHandler(async (req, res) => {
    const content = await Content.find();
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    return successResponse(res, content, "Content fetched successfully", 200);
});

cms.getPaginatedContent = asyncErrorHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const status = req.query.status; // optional: 'online', 'pending', 'archived'

    // Build query filter
    const filter = {};
    if (status) {
        filter.status = status;
    }

    // Calculate skip value
    const skip = (page - 1) * limit;

    // Get total count
    const totalCount = await Content.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Fetch paginated content
    const content = await Content.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    return successResponse(res, {
        magazines: content,
        pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        }
    }, "Content fetched successfully", 200);
});

cms.getContentById = asyncErrorHandler(async (req, res) => {
    const { id } = req.params;
    const content = await Content.findById(id).populate("created_by", "name");
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    const analytics = await Analytics.findOne({ content: id });
    const responseData = {
        ...content.toObject(),
        comments: analytics?.comments || [],
        likesCount: analytics?.likes?.length || 0,
        commentsCount: analytics?.comments?.length || 0
    };

    return successResponse(res, responseData, "Content fetched successfully", 200);
});


cms.addContent = asyncErrorHandler(async (req, res) => {
    let hero_img = "";
    if (req.file) {
        const uploadedUrl = await uploadToCloudinary(req.file.path, 'posts');
        if (uploadedUrl) {
            hero_img = uploadedUrl;
        } else {
            throw new InternalServerError("Failed to upload image");
        }
    }

    if (!req.body) {
        throw new BadRequestError("No data provided");
    }
    const { title, subtitle, body, est_read_time } = req.body;
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
        image_url: hero_img,
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

    const { id, title, subtitle, body, est_read_time } = req.body;
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

    let hero_img = "";
    if (req.file) {
        const uploadedUrl = await uploadToCloudinary(req.file.path, 'posts');
        if (uploadedUrl) {
            hero_img = uploadedUrl; // Update existing image
            // Delete the old image from Cloudinary if it exists
            if (content.image_url) {
                await deleteFromCloudinary(content.image_url);
            }
        } else {
            throw new InternalServerError("Failed to upload image");
        }
    }

    content.title = title || content.title;
    content.subtitle = subtitle || content.subtitle;
    content.image_url = hero_img || content.image_url;
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

    // Delete image from Cloudinary if it exists
    if (content.image_url) {
        await deleteFromCloudinary(content.image_url);
    }

    await content.deleteOne(); // remove() is deprecated
    // Also delete associated analytics
    await Analytics.findOneAndDelete({ content: id });
    return successResponse(res, null, "Content deleted successfully", 200);
});

// Analytics: Likes & Comments

cms.addLikeOnContent = asyncErrorHandler(async (req, res) => {
    const { contentId } = req.body;
    let userId = null;
    if (req.headers.authorization) {
        userId = getUserId(req.headers.authorization);
        if (!userId) {
            throw new UnauthorizedError("You are not authorized to add like");
        }
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
    } else {
        // Check if anonymous user (by IP) already liked
        const existingLike = await Analytics.findOne({
            content: contentId,
            "likes.ip_address": ipAddress,
            "likes.user": null,
        });
        if (existingLike) {
            throw new BadRequestError("You have already liked this content");
        }
    }
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
    let userId = null;
    if (req.headers.authorization) {
        userId = getUserId(req.headers.authorization);
        if (!userId) {
            throw new UnauthorizedError("You are not authorized to remove like");
        }
    }
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
    const { contentId, body } = req.body;
    let userId = null;
    if (req.headers.authorization) {
        userId = getUserId(req.headers.authorization);
        if (!userId) {
            throw new UnauthorizedError("You are not authorized to add comment");
        }
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
    let userId = null;
    let userRole = null;

    if (req.headers.authorization) {
        userId = getUserId(req.headers.authorization);
        if (userId) {
            const user = await User.findById(userId);
            if (user) {
                userRole = user.role;
            }
        }
    }
    const ipAddress = req.ip;

    if (!contentId || !commentId) {
        throw new BadRequestError("Content ID and Comment ID are required");
    }

    const analytics = await Analytics.findOne({ content: contentId });
    if (!analytics) throw new NotFoundError("Content Analytics not found");

    const comment = analytics.comments.id(commentId);
    if (!comment) throw new NotFoundError("Comment not found");

    const isAdmin = userRole === "admin";

    // Creator check:
    // 1. Authenticated: comment.created_by matches userId
    // 2. Anonymous: comment.created_by is null AND comment.ip_address matches req.ip (AND userId is null)
    const isCreator =
        (userId && comment.created_by && comment.created_by.toString() === userId) ||
        (!userId && !comment.created_by && comment.ip_address === ipAddress);

    // Authorization: Admin or Comment Creator
    if (!isAdmin && !isCreator) {
        throw new UnauthorizedError("Not authorized to delete this comment");
    }

    comment.deleteOne(); // helper method from mongoose subdoc
    await analytics.save();

    return successResponse(res, null, "Comment deleted successfully", 200);
});


// ADMIN: Admin apis..
cms.changeStatus = asyncErrorHandler(async (req, res) => {
    if (!req.body) {
        throw new BadRequestError("Body is required");
    }
    const { contentId, status } = req.body;
    const errors = [];
    if (!contentId) {
        errors.push("Content ID is required");
    }
    if (!status) {
        errors.push("Status is required");
    }
    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }
    if (status != "pending" && status != "archived" && status != "online") {
        throw new BadRequestError("Invalid status");
    }
    const content = await Content.findById(contentId);
    if (!content) throw new NotFoundError("Content not found");
    if (status === 'online') {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedError("Not authorized to publish content");
        }
    } else {
        if (req.user.role !== 'admin' && content.created_by.toString() !== req.user.id) {
            throw new UnauthorizedError("Not authorized to change status");
        }
    }
    content.status = status;
    await content.save();
    return successResponse(res, content, "Status changed successfully", 200);
});

export default cms;
