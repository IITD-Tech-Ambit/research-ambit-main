import e from "express";
import cms from "../controllers/cms.js";
import authMiddleware from "../middleware/authHandler.js";
import multer from 'multer';
const router = e.Router();



const upload = multer({ dest: '/tmp/' }); // Temporary storage for uploads

router.get('/', cms.getAllContent);
router.get('/:id', cms.getContentById);
router.post('/', authMiddleware("admin", "user"), upload.single('hero_img'), cms.addContent);
router.put('/', authMiddleware("admin", "user"), upload.single('hero_img'), cms.editContent);
router.delete('/', authMiddleware("admin", "user"), cms.deleteContent);
router.post('/like', cms.addLikeOnContent);
router.post('/dislike', cms.removeLikeOnContent);
router.post('/comment', cms.addCommentOnContent);
router.post('/uncomment', cms.deleteCommentOnContent);



export default router;
