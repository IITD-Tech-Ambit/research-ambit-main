/**
 * directory.v1.SuggestionService handler. Public write; the created id is the
 * only payload the REST endpoint returns, mapped to the typed
 * CreateSuggestionResponse { id }. Screenshot bytes are materialized to a temp
 * file so validation/cleanup/Cloudinary upload run through the shared service.
 */
import { unary } from "../handlerUtils.js";
import { writeUploadToTemp } from "../fileUpload.js";

export function createSuggestionHandlers(suggestionService) {
    return {
        CreateSuggestion: unary(async ({ request: r }) => {
            const { data } = await suggestionService.createSuggestion({
                name: r.name,
                email: r.email,
                category: r.category,
                message: r.message,
                screenshotPath: writeUploadToTemp(r.screenshot),
            });
            return { id: String(data.id) };
        }),
    };
}
