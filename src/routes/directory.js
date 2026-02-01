import e from "express"
import directory from "../controllers/directoryController.js";
const router = e.Router();



router.get("/", directory.getAllFaculties);
router.get("/:id", directory.getFacultiesById);
router.get("/coworkers/:id", directory.getFacultyCoworking);


export default router;