/**
 * directory.v1.ContentService handlers. Content docs are raw Mongoose
 * documents (with _id/__v/timestamps/populated refs/comment subdocs) that
 * proto3 can't round-trip faithfully, so reads/writes return them as
 * JSON.stringify(data) via JsonDataResponse. Auth is re-checked here against
 * gRPC metadata exactly as the REST middleware does; uploaded bytes are
 * materialized to a temp file so the shared service upload path is identical.
 */
import { unary } from "../handlerUtils.js";
import { requireAuth, optionalAuth, clientIp } from "../grpcAuth.js";
import { writeUploadToTemp } from "../fileUpload.js";

export function createContentHandlers(contentService) {
    return {
        ListContent: unary(async () => {
            const { data } = await contentService.listContent();
            return { data_json: JSON.stringify(data) };
        }),

        ListContentPaginated: unary(async ({ request: r, metadata }) => {
            const { userId } = optionalAuth(metadata);
            const { data } = await contentService.listContentPaginated({
                page: r.page,
                limit: r.limit,
                status: r.status,
                mine: r.mine,
                userId,
            });
            return { data_json: JSON.stringify(data) };
        }),

        GetContent: unary(async ({ request: r }) => {
            const { data } = await contentService.getContentById({ id: r.id });
            return { data_json: JSON.stringify(data) };
        }),

        CreateContent: unary(async ({ request: r, metadata }) => {
            const user = requireAuth(metadata, ["admin", "user"]);
            const { data } = await contentService.addContent(
                {
                    title: r.title,
                    subtitle: r.subtitle,
                    body: r.body,
                    est_read_time: r.est_read_time,
                    heroImgPath: writeUploadToTemp(r.hero_img),
                },
                user,
            );
            return { data_json: JSON.stringify(data) };
        }),

        UpdateContent: unary(async ({ request: r, metadata }) => {
            const user = requireAuth(metadata, ["admin", "user"]);
            const { data } = await contentService.editContent(
                {
                    id: r.id,
                    title: r.title,
                    subtitle: r.subtitle,
                    body: r.body,
                    est_read_time: r.est_read_time,
                    heroImgPath: writeUploadToTemp(r.hero_img),
                },
                user,
            );
            return { data_json: JSON.stringify(data) };
        }),

        DeleteContent: unary(async ({ request: r, metadata }) => {
            const user = requireAuth(metadata, ["admin", "user"]);
            const { message } = await contentService.deleteContent({ id: r.id }, user);
            return { message };
        }),

        LikeContent: unary(async ({ request: r, metadata }) => {
            const { userId, authProvided } = optionalAuth(metadata);
            const { data } = await contentService.addLikeOnContent({
                contentId: r.content_id,
                userId,
                authProvided,
                ip: clientIp(metadata),
            });
            return { data_json: JSON.stringify(data) };
        }),

        DislikeContent: unary(async ({ request: r, metadata }) => {
            const { userId, authProvided } = optionalAuth(metadata);
            const { data } = await contentService.removeLikeOnContent({
                contentId: r.content_id,
                userId,
                authProvided,
                ip: clientIp(metadata),
            });
            return { data_json: JSON.stringify(data) };
        }),

        CommentContent: unary(async ({ request: r, metadata }) => {
            const { userId, authProvided } = optionalAuth(metadata);
            const { data } = await contentService.addCommentOnContent({
                contentId: r.content_id,
                body: r.body,
                userId,
                authProvided,
                ip: clientIp(metadata),
            });
            return { data_json: JSON.stringify(data) };
        }),

        UncommentContent: unary(async ({ request: r, metadata }) => {
            const { userId } = optionalAuth(metadata);
            const { message } = await contentService.deleteCommentOnContent({
                contentId: r.content_id,
                commentId: r.comment_id,
                userId,
                ip: clientIp(metadata),
            });
            return { message };
        }),

        SetContentStatus: unary(async ({ request: r, metadata }) => {
            const user = requireAuth(metadata, ["admin", "user"]);
            const { data } = await contentService.changeStatus(
                { contentId: r.content_id, status: r.status },
                user,
            );
            return { data_json: JSON.stringify(data) };
        }),
    };
}
