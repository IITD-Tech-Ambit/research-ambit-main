import e from "express"
import multer from "multer";
import directory from "../controllers/directoryController.js";
const router = e.Router();

// Profile-image uploads land in a temp dir; cloudinary upload + unlink happen in
// the controller. Mirror the photo dialog's 8 MB and JPG/PNG/WebP policy on
// the server so a direct request cannot bypass the browser checks.
const PROFILE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const uploadImage = multer({
    dest: "/tmp/",
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, PROFILE_IMAGE_TYPES.has(file.mimetype)),
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
// Faculty self-edit of Background / Qualifications (owner-only; GET returns full
// content incl. hidden for the edit view, PATCH saves + validates).
router.get("/faculty/:kerberos/profile-extras", directory.getFacultyProfileExtras);
router.patch("/faculty/:kerberos/profile-extras", directory.updateFacultyProfileExtras);
router.get("/:id", directory.getFacultiesById);

export default router;