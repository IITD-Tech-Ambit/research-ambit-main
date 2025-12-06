import e from "express";
import userRouter from "./user.js";
const router = e.Router();
router.use("/user", userRouter);
export default router;
