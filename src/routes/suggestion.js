import e from 'express';
import multer from 'multer';
import suggestion from '../controllers/suggestion.js';

const upload = multer({
    dest: 'tmp/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (JPG, PNG, GIF, WebP) are allowed.'));
        }
    },
});

const router = e.Router();

router.post('/', upload.single('screenshot'), suggestion.submit);

export default router;
