/**
 * Content/CMS application service facade. Split into CRUD and engagement;
 * this barrel keeps REST and gRPC imports stable.
 */
export {
    listContent,
    listContentPaginated,
    getContentById,
    addContent,
    editContent,
    deleteContent,
    changeStatus,
} from "./contentCrudService.js";

export {
    addLikeOnContent,
    removeLikeOnContent,
    addCommentOnContent,
    deleteCommentOnContent,
} from "./contentEngagementService.js";
