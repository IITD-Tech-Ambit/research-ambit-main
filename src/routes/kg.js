import e from "express";
import kg from "../controllers/kgController.js";

const router = e.Router();

router.get("/health", kg.health);
router.get("/faculty", kg.getFacultyIndex);
router.get("/faculty/:id/knowledge-graph", kg.getFacultyGraph);
router.get("/explore/terms", kg.getExploreTerms);
router.get("/explore/detail", kg.getExploreDetail);
router.get("/paper/:id/meta", kg.getPaperMeta);
router.get("/atlas", kg.getAtlas);
router.get("/atlas/search", kg.searchAtlas);
router.get("/atlas/faculty-indices", kg.getFacultyAtlasIndices);
router.get("/atlas/faculty-search", kg.searchAtlasFaculty);
router.get("/atlas/department-indices", kg.getDepartmentAtlasIndices);
router.get("/atlas/department-search", kg.searchAtlasDepartment);
router.get("/atlas/cluster-breakdown", kg.getAtlasClusterBreakdown);

export default router;
