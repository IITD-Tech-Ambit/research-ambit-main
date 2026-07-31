import e from "express"
import multer from "multer";
import directory from "../controllers/directoryController.js";
const router = e.Router();

// Profile-image uploads land in a temp dir; cloudinary upload + unlink happen in
// the controller. Cap at 5 MB and accept images only.
const uploadImage = multer({
    dest: "/tmp/",
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

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
// Faculty self-edit of their own profile image (auth enforced in the gateway +
// the owner check in the controller).
router.post("/faculty/:kerberos/image", uploadImage.single("image"), directory.updateFacultyImage);
router.patch("/faculty/:kerberos/visibility", directory.updateFacultyVisibility);
router.get("/:id", directory.getFacultiesById);

export default router;