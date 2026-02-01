import express from 'express';
import {
  getCategories,
  getDepartments,
  getSchools,
  getCentres,
  getFacultiesByDepartment,
  getProjectTypes,
  getPhdThesesByFaculty,
  getPhdThesisById,
  getResearchByFaculty,
  getResearchById,
  getOpenPath
} from '../controllers/mindMap.js';

const router = express.Router();

// ==================== Layer 2: Categories ====================
router.get('/categories', getCategories);

// ==================== Layer 3: Department Collections ====================
router.get('/departments', getDepartments);
router.get('/schools', getSchools);
router.get('/centres', getCentres);

// ==================== Layer 4: Faculty Members ====================
router.get('/faculties/:departmentId', getFacultiesByDepartment);

// ==================== Layer 5: Project Types ====================
router.get('/project-type', getProjectTypes);

// ==================== Layer 6a: PhD Theses ====================
router.get('/phd-thesis/:facultyId', getPhdThesesByFaculty);
router.get('/phd-thesis/card/:thesisId', getPhdThesisById);

// ==================== Layer 6b: Research Papers ====================
router.get('/research/:facultyId', getResearchByFaculty);
router.get('/research/card/:researchId', getResearchById);

// ==================== Open Path API ====================
router.post('/open-path', getOpenPath);

export default router;
