import e from "express";
import cms from "../controllers/cms.js";
const router = e.Router();



router.get('/', cms.getAllContent);
router.post('/', cms.addContent);
router.put('/', cms.editContent);
router.delete('/', cms.deleteContent);
router.post('/like', cms.addLikeOnContent);
router.post('/dislike', cms.removeLikeOnContent);
router.post('/comment', cms.addCommentOnContent);
router.post('/uncomment', cms.deleteCommentOnContent);



export default router;
