import e from "express";
import userRouter from "./user.js";
import contentRouter from "./content.js";
import mindMapRouter from "./mindMap.js";
const router = e.Router();
router.use("/user", userRouter);
router.use("/content", contentRouter);
router.use("/mind-map", mindMapRouter);
export default router;
