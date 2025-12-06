import e from "express";
import userRouter from "./user.js";
import contentRouter from "./content.js";
const router = e.Router();
router.use("/user", userRouter);
router.use("/content", contentRouter);
export default router;
