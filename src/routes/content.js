import e from "express";
import cms from "../controllers/cms.js";
import authMiddleware from "../middleware/authHandler.js";
import multer from 'multer';
const router = e.Router();



const upload = multer({
    dest: '/tmp/',
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

router.get('/', cms.getAllContent);
router.get('/paginated', cms.getPaginatedContent);
router.get('/:id', cms.getContentById);
router.post('/', authMiddleware("admin", "user"), upload.single('hero_img'), cms.addContent);
router.put('/', authMiddleware("admin", "user"), upload.single('hero_img'), cms.editContent);
router.delete('/', authMiddleware("admin", "user"), cms.deleteContent);
router.post('/like', cms.addLikeOnContent);
router.post('/dislike', cms.removeLikeOnContent);
router.post('/comment', cms.addCommentOnContent);
router.post('/uncomment', cms.deleteCommentOnContent);
router.post('/status', authMiddleware("admin", "user"), cms.changeStatus);



export default router;
