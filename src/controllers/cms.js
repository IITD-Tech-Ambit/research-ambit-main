import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import { getUserId } from "../lib/userIdExtractor.js";
import * as contentService from "../services/contentService.js";

let cms = {};

cms.getAllContent = asyncErrorHandler(async (req, res) => {
    const { data, message } = await contentService.listContent();
    return successResponse(res, data, message, 200);
});

cms.getPaginatedContent = asyncErrorHandler(async (req, res) => {
    const mine = req.query.mine === 'true';
    const userId = mine && req.headers.authorization ? getUserId(req.headers.authorization) : null;
    const { data, message } = await contentService.listContentPaginated({
        page: req.query.page,
        limit: req.query.limit,
        status: req.query.status,
        mine,
        userId,
    });
    return successResponse(res, data, message, 200);
});

cms.getContentById = asyncErrorHandler(async (req, res) => {
    const { data, message } = await contentService.getContentById({ id: req.params.id });
    return successResponse(res, data, message, 200);
});

cms.addContent = asyncErrorHandler(async (req, res) => {
    const { data, message, statusCode } = await contentService.addContent({
        title: req.body?.title,
        subtitle: req.body?.subtitle,
        body: req.body?.body,
        est_read_time: req.body?.est_read_time,
        heroImgPath: req.file?.path || null,
    }, req.user);
    return successResponse(res, data, message, statusCode);
});

cms.editContent = asyncErrorHandler(async (req, res) => {
    const { data, message } = await contentService.editContent({
        id: req.body?.id,
        title: req.body?.title,
        subtitle: req.body?.subtitle,
        body: req.body?.body,
        est_read_time: req.body?.est_read_time,
        heroImgPath: req.file?.path || null,
    }, req.user);
    return successResponse(res, data, message, 200);
});

cms.deleteContent = asyncErrorHandler(async (req, res) => {
    const { data, message } = await contentService.deleteContent({ id: req.body?.id }, req.user);
    return successResponse(res, data, message, 200);
});

cms.addLikeOnContent = asyncErrorHandler(async (req, res) => {
    const authProvided = !!req.headers.authorization;
    const userId = authProvided ? getUserId(req.headers.authorization) : null;
    const { data, message } = await contentService.addLikeOnContent({
        contentId: req.body?.contentId,
        userId,
        authProvided,
        ip: req.ip,
    });
    return successResponse(res, data, message, 200);
});

cms.removeLikeOnContent = asyncErrorHandler(async (req, res) => {
    const authProvided = !!req.headers.authorization;
    const userId = authProvided ? getUserId(req.headers.authorization) : null;
    const { data, message } = await contentService.removeLikeOnContent({
        contentId: req.body?.contentId,
        userId,
        authProvided,
        ip: req.ip,
    });
    return successResponse(res, data, message, 200);
});

cms.addCommentOnContent = asyncErrorHandler(async (req, res) => {
    const authProvided = !!req.headers.authorization;
    const userId = authProvided ? getUserId(req.headers.authorization) : null;
    const { data, message, statusCode } = await contentService.addCommentOnContent({
        contentId: req.body?.contentId,
        body: req.body?.body,
        userId,
        authProvided,
        ip: req.ip,
    });
    return successResponse(res, data, message, statusCode);
});

cms.deleteCommentOnContent = asyncErrorHandler(async (req, res) => {
    const userId = req.headers.authorization ? getUserId(req.headers.authorization) : null;
    const { data, message } = await contentService.deleteCommentOnContent({
        contentId: req.body?.contentId,
        commentId: req.body?.commentId,
        userId,
        ip: req.ip,
    });
    return successResponse(res, data, message, 200);
});

cms.changeStatus = asyncErrorHandler(async (req, res) => {
    const { data, message } = await contentService.changeStatus({
        contentId: req.body?.contentId,
        status: req.body?.status,
    }, req.user);
    return successResponse(res, data, message, 200);
});

export default cms;
