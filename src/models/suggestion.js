import mongoose from 'mongoose';

const CATEGORIES = [
    'Website Feedback',
    'Feature Request',
    'Missing Research Information',
    'Bug Report',
    'Other',
];

const suggestionSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            trim: true,
            default: '',
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
            default: '',
        },
        category: {
            type: String,
            enum: CATEGORIES,
            required: true,
        },
        message: {
            type: String,
            required: true,
            trim: true,
            minlength: 10,
            maxlength: 2000,
        },
        screenshotUrl: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

const Suggestion = mongoose.model('Suggestion', suggestionSchema);

export { CATEGORIES };
export default Suggestion;
