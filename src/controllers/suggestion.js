import Suggestion, { CATEGORIES } from '../models/suggestion.js';
import { asyncErrorHandler } from '../middleware/errorHandler.js';
import { successResponse } from '../lib/responseUtils.js';
import { ValidationError } from '../lib/customErrors.js';
import { sendSuggestionEmail } from '../utils/mailer.js';
import { uploadToCloudinary } from '../lib/cloudinary.js';
import fs from 'fs';

const suggestion = {};

suggestion.submit = asyncErrorHandler(async (req, res) => {
    const { name, email, category, message } = req.body;
    const file = req.file;

    // Validate
    const errors = [];

    if (!category || !CATEGORIES.includes(category)) {
        errors.push({ field: 'category', message: `Category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
        errors.push({ field: 'message', message: 'Message must be at least 10 characters.' });
    }
    if (message && message.trim().length > 2000) {
        errors.push({ field: 'message', message: 'Message must not exceed 2000 characters.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        errors.push({ field: 'email', message: 'Please provide a valid email address.' });
    }

    if (errors.length > 0) {
        // Clean up temp file if validation fails
        if (file?.path) fs.existsSync(file.path) && fs.unlinkSync(file.path);
        throw new ValidationError('Validation failed', errors);
    }

    // Upload screenshot to Cloudinary (if provided)
    let screenshotUrl = '';
    if (file?.path) {
        const uploaded = await uploadToCloudinary(file.path, 'research-ambit/suggestions');
        screenshotUrl = uploaded || '';
    }

    const newSuggestion = await Suggestion.create({
        name: name?.trim() || '',
        email: email?.trim() || '',
        category,
        message: message.trim(),
        screenshotUrl,
    });

    // Fire email in background
    sendSuggestionEmail(newSuggestion).catch((err) =>
        console.error('[Mailer] Failed to send suggestion email:', err.message)
    );

    return successResponse(
        res,
        { id: newSuggestion._id },
        'Thank you! Your suggestion has been received.',
        201
    );
});

export default suggestion;
