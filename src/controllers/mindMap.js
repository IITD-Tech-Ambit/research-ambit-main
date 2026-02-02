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

// Get all departments (excluding schools, centres, and 'Other' category)
export const getDepartments = async (req, res) => {
  try {
    const departments = await Department.find({
      name: { 
        $not: { $regex: /centre|center|school/i } 
      },
      // Exclude departments with category 'Other'
      category: { $ne: 'Other' }
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

// ==================== Open Path API ====================

// Get mind map path for a given document
export const getOpenPath = async (req, res) => {
  try {
    const documentData = req.body;
    
    if (!documentData || Object.keys(documentData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Document data is required in request body'
      });
    }
    
    // Determine project type based on document_eid field
    const projectType = documentData.document_eid ? 'Research' : 'PHD Thesis';
    
    // Get faculty_id based on project type
    let facultyId = null;
    
    if (projectType === 'PHD Thesis') {
      // For PhD Thesis: get from contributor.advisor.matched_profile
      facultyId = documentData.contributor?.advisor?.matched_profile;
      
      // Handle if matched_profile is an object with $oid (from JSON export)
      if (facultyId && typeof facultyId === 'object' && facultyId.$oid) {
        facultyId = facultyId.$oid;
      }
    } else {
      // For Research: get first non-null matched_profile from authors array
      if (documentData.authors && Array.isArray(documentData.authors)) {
        for (const author of documentData.authors) {
          if (author.matched_profile) {
            facultyId = author.matched_profile;
            // Handle if matched_profile is an object with $oid
            if (typeof facultyId === 'object' && facultyId.$oid) {
              facultyId = facultyId.$oid;
            }
            break;
          }
        }
      }
    }
    
    if (!facultyId) {
      return res.status(400).json({
        success: false,
        error: 'No matched faculty profile found in document'
      });
    }
    
    // Validate faculty ObjectId
    if (!mongoose.Types.ObjectId.isValid(facultyId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid faculty ID in document'
      });
    }
    
    // Get department_id from faculty collection
    const faculty = await Faculty.findById(facultyId);
    
    if (!faculty) {
      return res.status(404).json({
        success: false,
        error: 'Faculty not found'
      });
    }
    
    const departmentId = faculty.department;
    
    if (!departmentId) {
      return res.status(404).json({
        success: false,
        error: 'Department not found for faculty'
      });
    }
    
    // Get department name to determine category
    const department = await Department.findById(departmentId);
    
    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }
    
    // Determine category based on department name
    const deptName = department.name.toLowerCase();
    let category;
    
    if (deptName.includes('school')) {
      category = 'Schools';
    } else if (deptName.includes('centre') || deptName.includes('center')) {
      category = 'Centres';
    } else {
      category = 'Departments';
    }
    
    // Get document _id
    const docId = documentData._id?.$oid || documentData._id;
    
    res.json({
      success: true,
      data: {
        project_type: projectType,
        faculty_id: facultyId.toString(),
        department_id: departmentId.toString(),
        category: category,
        doc_id: docId ? docId.toString() : null
      }
    });
  } catch (error) {
    console.error('Error getting open path:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get open path'
    });
  }
};

// ==================== Temporary Endpoint: Get Full Research Document ====================
export const getResearchTemporary = async (req, res) => {
  try {
    const { _id } = req.body;
    
    if (!_id) {
      return res.status(400).json({
        success: false,
        error: 'Research document _id is required in request body'
      });
    }
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid research document ID'
      });
    }
    
    // Get full research document from researchmetadatacorpus collection
    const research = await ResearchMetadata.findById(_id);
    
    if (!research) {
      return res.status(404).json({
        success: false,
        error: 'Research document not found'
      });
    }
    
    res.json({
      success: true,
      data: research
    });
  } catch (error) {
    console.error('Error fetching research document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch research document'
    });
  }
};
