/**
 * CMS content CRUD: transport-agnostic logic for create/read/update/delete and
 * status changes. Likes/comments live in contentEngagementService.
 *
 * Auth is resolved by the caller and passed in as plain data — never req/res.
 */
import Content from "../models/contents.js";
import Analytics from "../models/analytics.js";
import {
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
    InternalServerError,
} from "../lib/customErrors.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary.js";
import { cacheGet, cacheSetEx } from "../lib/cache.js";

const CONTENT_CACHE_TTL_S = 60;

function assertContentOwnerOrAdmin(content, user, action) {
    if (content.created_by.toString() !== user.id && user.role !== "admin") {
        throw new UnauthorizedError(`You are not authorized to ${action} this content`);
    }
}

export const listContent = async () => {
    // Unbounded by design elsewhere in this codebase's list endpoints; capped
    // here as a safety net since nothing calls this with pagination params.
    const content = await Content.find().limit(500);
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    return { data: content, message: "Content fetched successfully" };
};

export const listContentPaginated = async ({ page, limit, status, mine, userId } = {}) => {
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 9;

    const filter = {};
    if (status) {
        filter.status = status;
    }

    // `mine` scopes to the caller's own content; userId is resolved upstream
    // (REST: getUserId(header); gRPC: verified JWT identity).
    let scopedUserId = null;
    if (mine && userId) {
        scopedUserId = userId;
        filter.created_by = scopedUserId;
    }

    // Short TTL since content list changes on publish/edit/delete, which
    // this cache doesn't explicitly invalidate — self-heals within a minute.
    const cacheKey = `content:paginated:${p}:${l}:${status || ''}:${mine ? scopedUserId || '' : ''}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
        const { data, message } = JSON.parse(cached);
        return { data, message, cached: true };
    }

    const skip = (p - 1) * l;
    const totalCount = await Content.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / l);

    const content = await Content.find(filter)
        .populate("created_by", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l);

    const data = {
        magazines: content,
        pagination: {
            currentPage: p,
            totalPages,
            totalCount,
            limit: l,
            hasNextPage: p < totalPages,
            hasPrevPage: p > 1
        }
    };
    const message = "Content fetched successfully";

    await cacheSetEx(cacheKey, CONTENT_CACHE_TTL_S, JSON.stringify({ data, message }));
    return { data, message, cached: false };
};

export const getContentById = async ({ id } = {}) => {
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

    return { data: responseData, message: "Content fetched successfully" };
};

export const addContent = async ({ title, subtitle, body, est_read_time, heroImgPath } = {}, user) => {
    let hero_img = "";
    if (heroImgPath) {
        const uploadedUrl = await uploadToCloudinary(heroImgPath, 'posts');
        if (uploadedUrl) {
            hero_img = uploadedUrl;
        } else {
            throw new InternalServerError("Failed to upload image");
        }
    }

    const errors = [];
    if (!title) errors.push({ field: "title", message: "Title is required" });
    if (!subtitle) errors.push({ field: "subtitle", message: "Subtitle is required" });
    if (!hero_img) errors.push({ field: "hero_img", message: "Hero Image is required" });
    if (!body) errors.push({ field: "body", message: "Body is required" });
    if (!est_read_time) errors.push({ field: "est_read_time", message: "Estimated Read Time is required" });

    if (errors.length > 0) {
        throw new ValidationError("Validation Error", errors);
    }

    const content = await Content.create({
        title,
        subtitle,
        image_url: hero_img,
        body,
        est_read_time,
        created_by: user.id,
    });

    if (!content) {
        throw new InternalServerError("Failed to create content");
    }

    await Analytics.create({ content: content._id });

    return { data: content, message: "Content created successfully", statusCode: 201 };
};

export const editContent = async ({ id, title, subtitle, body, est_read_time, heroImgPath } = {}, user) => {
    const content = await Content.findById(id);
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    assertContentOwnerOrAdmin(content, user, "edit");

    let hero_img = "";
    if (heroImgPath) {
        const uploadedUrl = await uploadToCloudinary(heroImgPath, 'posts');
        if (uploadedUrl) {
            hero_img = uploadedUrl;
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
    return { data: content, message: "Content updated successfully" };
};

export const deleteContent = async ({ id } = {}, user) => {
    const content = await Content.findById(id);
    if (!content) {
        throw new NotFoundError("Content not found");
    }
    assertContentOwnerOrAdmin(content, user, "delete");

    if (content.image_url) {
        await deleteFromCloudinary(content.image_url);
    }

    await content.deleteOne();
    await Analytics.findOneAndDelete({ content: id });
    return { data: null, message: "Content deleted successfully" };
};

export const changeStatus = async ({ contentId, status } = {}, user) => {
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
        if (user.role !== 'admin') {
            throw new UnauthorizedError("Not authorized to publish content");
        }
    } else {
        if (user.role !== 'admin' && content.created_by.toString() !== user.id) {
            throw new UnauthorizedError("Not authorized to change status");
        }
    }
    content.status = status;
    await content.save();
    return { data: content, message: "Status changed successfully" };
};
