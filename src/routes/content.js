import e from "express";
import cms from "../controllers/cms.js";
import authMiddleware from "../middleware/authHandler.js";
const router = e.Router();



router.get('/', cms.getAllContent);
router.post('/', authMiddleware("admin", "user"), cms.addContent);
router.put('/', authMiddleware("admin", "user"), cms.editContent);
router.delete('/', authMiddleware("admin", "user"), cms.deleteContent);
router.post('/like', cms.addLikeOnContent);
router.post('/dislike', cms.removeLikeOnContent);
router.post('/comment', cms.addCommentOnContent);
router.post('/uncomment', cms.deleteCommentOnContent);



export default router;
