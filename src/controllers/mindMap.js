import Department from '../models/departments.js';
import Faculty from '../models/faculty.js';
import PhdThesis from '../models/phd_thesis.js';
import ResearchMetadata from '../models/research_scopus.js';
import mongoose from 'mongoose';

// ==================== Layer 2: Categories ====================

// Get root categories (hardcoded)
export const getCategories = async (req, res) => {
  try {
    res.json({
      success: true,
      count: 3,
      data: ['Departments', 'Schools', 'Centres']
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
};

// ==================== Layer 3: Department Collections ====================

// Get all departments (excluding schools and centres)
export const getDepartments = async (req, res) => {
  try {
    const departments = await Department.find({
      name: { 
        $not: { $regex: /centre|center|school/i } 
      }
    }).sort({ name: 1 });

    const departmentData = departments.map(dept => ({
      _id: dept._id.toString(),
      name: dept.name
    }));

    res.json({
      success: true,
      count: departmentData.length,
      data: departmentData
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch departments'
    });
  }
};

// Get all schools
export const getSchools = async (req, res) => {
  try {
    const schools = await Department.find({
      name: { $regex: /school/i }
    }).sort({ name: 1 });

    const schoolData = schools.map(school => ({
      _id: school._id.toString(),
      name: school.name
    }));

    res.json({
      success: true,
      count: schoolData.length,
      data: schoolData
    });
  } catch (error) {
    console.error('Error fetching schools:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schools'
    });
  }
};

// Get all centres
export const getCentres = async (req, res) => {
  try {
    const centres = await Department.find({
      name: { $regex: /centre|center/i }
    }).sort({ name: 1 });

    const centreData = centres.map(centre => ({
      _id: centre._id.toString(),
      name: centre.name
    }));

    res.json({
      success: true,
      count: centreData.length,
      data: centreData
    });
  } catch (error) {
    console.error('Error fetching centres:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch centres'
    });
  }
};

// ==================== Layer 4: Faculty Members ====================

// Get all faculty members by department/school/centre ID
export const getFacultiesByDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }
    
    // Find all faculties with this department _id
    const faculties = await Faculty.find({ 
      department: departmentId 
    }).sort({ name: 1 });
    
    const facultyData = faculties.map(faculty => ({
      _id: faculty._id.toString(),
      name: faculty.name
    }));
    
    res.json({
      success: true,
      count: facultyData.length,
      data: facultyData
    });
  } catch (error) {
    console.error('Error fetching faculties:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch faculties'
    });
  }
};

// ==================== Layer 5: Project Types ====================

// Get project types (static data)
export const getProjectTypes = async (req, res) => {
  try {
    const projectTypes = ['PHD Thesis', 'Research'];
    
    res.json({
      success: true,
      count: projectTypes.length,
      data: projectTypes
    });
  } catch (error) {
    console.error('Error fetching project types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project types'
    });
  }
};

// ==================== Layer 6a: PhD Theses ====================

// Get all PhD theses by faculty ID
export const getPhdThesesByFaculty = async (req, res) => {
  try {
    const { facultyId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(facultyId)) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }
    
    // Find all PhD theses where matched_profile matches the faculty ID
    const theses = await PhdThesis.find({
      'contributor.advisor.matched_profile': facultyId
    }).sort({ publication_year: -1, title: 1 });
    
    const thesisData = theses.map(thesis => ({
      _id: thesis._id.toString(),
      title: thesis.title
    }));
    
    res.json({
      success: true,
      count: thesisData.length,
      data: thesisData
    });
  } catch (error) {
    console.error('Error fetching PhD theses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch PhD theses'
    });
  }
};

// Get PhD thesis details by ID
export const getPhdThesisById = async (req, res) => {
  try {
    const { thesisId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(thesisId)) {
      return res.status(404).json({
        success: false,
        error: 'Invalid thesis ID'
      });
    }
    
    const thesis = await PhdThesis.findById(thesisId);
    
    if (!thesis) {
      return res.status(404).json({
        success: false,
        error: 'Thesis not found'
      });
    }
    
    res.json({
      success: true,
      data: thesis
    });
  } catch (error) {
    console.error('Error fetching thesis details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch thesis details'
    });
  }
};

// ==================== Layer 6b: Research Papers ====================

// Get all research papers by faculty ID
export const getResearchByFaculty = async (req, res) => {
  try {
    const { facultyId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(facultyId)) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }
    
    // Find all research papers where authors array contains matched_profile matching the faculty ID
    const research = await ResearchMetadata.find({
      'authors.matched_profile': facultyId
    }).sort({ publication_year: -1, title: 1 });
    
    const researchData = research.map(paper => ({
      _id: paper._id.toString(),
      title: paper.title
    }));
    
    res.json({
      success: true,
      count: researchData.length,
      data: researchData
    });
  } catch (error) {
    console.error('Error fetching research papers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch research papers'
    });
  }
};

// Get research paper details by ID
export const getResearchById = async (req, res) => {
  try {
    const { researchId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(researchId)) {
      return res.status(404).json({
        success: false,
        error: 'Invalid research paper ID'
      });
    }
    
    const research = await ResearchMetadata.findById(researchId);
    
    if (!research) {
      return res.status(404).json({
        success: false,
        error: 'Research paper not found'
      });
    }
    
    res.json({
      success: true,
      data: research
    });
  } catch (error) {
    console.error('Error fetching research paper details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch research paper details'
    });
  }
};
