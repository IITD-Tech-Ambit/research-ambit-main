/**
 * CMS engagement: likes and comments on content analytics.
 * Optional-auth RPCs receive { userId, authProvided, ip }: `authProvided` true
 * + null `userId` reproduces the "token present but invalid" 401.
 */
import Analytics from "../models/analytics.js";
import User from "../models/user.js";
import {
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
} from "../lib/customErrors.js";

function assertOptionalAuth(authProvided, userId, action) {
    if (authProvided && !userId) {
        throw new UnauthorizedError(`You are not authorized to ${action}`);
    }
}

export const addLikeOnContent = async ({ contentId, userId, authProvided, ip } = {}) => {
    assertOptionalAuth(authProvided, userId, "add like");

    if (!contentId) {
        throw new BadRequestError("Content ID is required");
    }

    // Dedup per authenticated user id, else per anonymous IP.
    if (userId) {
        const existingLike = await Analytics.findOne({
            content: contentId,
            "likes.user": userId,
        });
        if (existingLike) {
            throw new BadRequestError("You have already liked this content");
        }
    } else {
        const existingLike = await Analytics.findOne({
            content: contentId,
            "likes.ip_address": ip,
            "likes.user": null,
        });
        if (existingLike) {
            throw new BadRequestError("You have already liked this content");
        }
    }
    const query = { content: contentId };
    const likeObj = { ip_address: ip, user: userId || null };

    const analytics = await Analytics.findOneAndUpdate(
        query,
        { $addToSet: { likes: likeObj } },
        { new: true, upsert: true }
    );

    return { data: analytics, message: "Like added successfully" };
};

export const removeLikeOnContent = async ({ contentId, userId, authProvided, ip } = {}) => {
    assertOptionalAuth(authProvided, userId, "remove like");

    if (!contentId) {
        throw new BadRequestError("Content ID is required");
    }

    const query = { content: contentId };
    const pullQuery = {};
    if (userId) {
        pullQuery.user = userId;
    } else {
        pullQuery.ip_address = ip;
        pullQuery.user = null;
    }

    const analytics = await Analytics.findOneAndUpdate(
        query,
        { $pull: { likes: pullQuery } },
        { new: true }
    );

    if (!analytics) throw new NotFoundError("Analytics not found");

    return { data: analytics, message: "Like removed successfully" };
};

export const addCommentOnContent = async ({ contentId, body, userId, authProvided, ip } = {}) => {
    assertOptionalAuth(authProvided, userId, "add comment");

    if (!contentId || !body) {
        throw new BadRequestError("Content ID and comment body are required");
    }

    const checkQuery = { content: contentId };
    if (userId) {
        checkQuery["comments.created_by"] = userId;
    } else {
        checkQuery["comments.ip_address"] = ip;
        checkQuery["comments.created_by"] = null;
    }

    const existingComment = await Analytics.findOne(checkQuery);
    if (existingComment) {
        throw new BadRequestError("You have already commented on this content");
    }

    const comment = {
        body,
        ip_address: ip,
        created_by: userId,
    };

    const analytics = await Analytics.findOneAndUpdate(
        { content: contentId },
        { $push: { comments: comment } },
        { new: true, upsert: true }
    );

    return {
        data: analytics.comments[analytics.comments.length - 1],
        message: "Comment added successfully",
        statusCode: 201,
    };
};

export const deleteCommentOnContent = async ({ contentId, commentId, userId, ip } = {}) => {
    let userRole = null;
    if (userId) {
        const foundUser = await User.findById(userId);
        if (foundUser) {
            userRole = foundUser.role;
        }
    }

    if (!contentId || !commentId) {
        throw new BadRequestError("Content ID and Comment ID are required");
    }

    const analytics = await Analytics.findOne({ content: contentId });
    if (!analytics) throw new NotFoundError("Content Analytics not found");

    const comment = analytics.comments.id(commentId);
    if (!comment) throw new NotFoundError("Comment not found");

    const isAdmin = userRole === "admin";
    const isCreator =
        (userId && comment.created_by && comment.created_by.toString() === userId) ||
        (!userId && !comment.created_by && comment.ip_address === ip);

    if (!isAdmin && !isCreator) {
        throw new UnauthorizedError("Not authorized to delete this comment");
    }

    comment.deleteOne();
    await analytics.save();

    return { data: null, message: "Comment deleted successfully" };
};
