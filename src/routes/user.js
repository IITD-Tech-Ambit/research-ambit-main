import e from "express"
import user from "../controllers/user.js";
const router = e.Router();




router.post("/register", user.register);
router.post("/login", user.login);

export default router;
