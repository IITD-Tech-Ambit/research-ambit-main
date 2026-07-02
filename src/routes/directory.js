import e from "express"
import directory from "../controllers/directoryController.js";
const router = e.Router();

router.get("/", directory.getAllFaculties);
router.get("/search", directory.searchFaculties);
router.get("/grouped", directory.getFacultiesGroupedByDepartment);
router.get("/grouped/:departmentId/faculties", directory.getFacultiesForDepartmentGroup);
router.get("/by-scopus/:scopusId", directory.getFacultyByScopusId);
router.post("/by-scopus/batch", directory.resolveFacultiesByScopusIds);
router.post("/by-kerberos/batch", directory.resolveFacultiesByKerberos);
router.get("/faculty/:kerberos/profile", directory.getFacultyByKerberos);
router.get("/faculty/:kerberos/research-summary", directory.getFacultyResearchSummary);
router.get("/faculty/:kerberos/publications", directory.getFacultyPublications);
router.get("/:id", directory.getFacultiesById);

export default router;