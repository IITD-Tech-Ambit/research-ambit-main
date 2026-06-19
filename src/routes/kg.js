import e from "express";
import kg from "../controllers/kgController.js";

const router = e.Router();

router.get("/health", kg.health);
router.get("/faculty", kg.getFacultyIndex);
router.get("/faculty/:id/knowledge-graph", kg.getFacultyGraph);
router.get("/explore/terms", kg.getExploreTerms);
router.get("/explore/detail", kg.getExploreDetail);
router.get("/paper/:id/meta", kg.getPaperMeta);

export default router;
