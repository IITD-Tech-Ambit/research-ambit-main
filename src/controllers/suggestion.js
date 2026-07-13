import { asyncErrorHandler } from '../middleware/errorHandler.js';
import { successResponse } from '../lib/responseUtils.js';
import * as suggestionService from '../services/suggestionService.js';

const suggestion = {};

suggestion.submit = asyncErrorHandler(async (req, res) => {
    const { data, message, statusCode } = await suggestionService.createSuggestion({
        name: req.body?.name,
        email: req.body?.email,
        category: req.body?.category,
        message: req.body?.message,
        screenshotPath: req.file?.path || null,
    });
    return successResponse(res, data, message, statusCode);
});

export default suggestion;
