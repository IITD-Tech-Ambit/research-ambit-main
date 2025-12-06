import e from "express"
import user from "../controllers/user.js";
import authMiddleware from "../middleware/authHandler.js";
const router = e.Router();




router.post("/register", user.register);
router.post("/login", user.login);
router.patch("/edit", user.editUser);
router.delete("/delete", authMiddleware("admin"), user.deleteUser);

export default router;
