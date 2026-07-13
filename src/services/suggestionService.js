/**
 * Suggestion (feedback intake) application service: transport-agnostic logic
 * behind POST /api/suggestions/. Extracted from controllers/suggestion.js so
 * the REST handler and the directory.v1 SuggestionService gRPC handler share
 * ONE implementation. The screenshot is passed as a local temp file path
 * (multer for REST; bytes written to a temp file for gRPC).
 */
import Suggestion, { CATEGORIES } from '../models/suggestion.js';
import { ValidationError } from '../lib/customErrors.js';
import { sendSuggestionEmail } from '../utils/mailer.js';
import { uploadToCloudinary } from '../lib/cloudinary.js';
import fs from 'fs';

export const createSuggestion = async ({ name, email, category, message, screenshotPath } = {}) => {
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
        if (screenshotPath) fs.existsSync(screenshotPath) && fs.unlinkSync(screenshotPath);
        throw new ValidationError('Validation failed', errors);
    }

    let screenshotUrl = '';
    if (screenshotPath) {
        const uploaded = await uploadToCloudinary(screenshotPath, 'research-ambit/suggestions');
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

    return {
        data: { id: newSuggestion._id },
        message: 'Thank you! Your suggestion has been received.',
        statusCode: 201,
    };
};
