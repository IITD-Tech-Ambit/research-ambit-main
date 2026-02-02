import e from "express"
import directory from "../controllers/directoryController.js";
const router = e.Router();



router.get("/", directory.getAllFaculties);
router.get("/search", directory.searchFaculties);
router.get("/grouped", directory.getFacultiesGroupedByDepartment);
router.get("/:id", directory.getFacultiesById);
router.get("/coworkers/:id", directory.getFacultyCoworking);


export default router;