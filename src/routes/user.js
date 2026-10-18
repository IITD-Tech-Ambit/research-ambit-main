import e from "express"
import user from "../controllers/user.js";
import authMiddleware from "../middleware/authHandler.js";
import multer from 'multer';

const router = e.Router();
const upload = multer({
    dest: '/tmp/',
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

router.post("/register", authMiddleware("admin"), upload.single('profile_img'), user.register);
router.post("/login", user.login);
router.put("/edit", authMiddleware(), upload.single('profile_img'), user.editUser);
router.delete("/delete", authMiddleware("admin"), user.deleteUser);

export default router;
