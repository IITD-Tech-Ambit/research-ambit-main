import e from "express"
import user from "../controllers/user.js";
import authMiddleware from "../middleware/authHandler.js";
import multer from 'multer';

const router = e.Router();
const upload = multer({ dest: '/tmp/' });

router.post("/register", upload.single('profile_img'), user.register);
router.post("/login", user.login);
router.put("/edit", authMiddleware(), upload.single('profile_img'), user.editUser);
router.delete("/delete", authMiddleware("admin"), user.deleteUser);

export default router;
