/**
 * Link papers to faculty via dual strategy:
 *   1. kerberos  — paper.kerberos === faculty.email prefix (primary authored papers)
 *   2. scopus_id — paper.authors[].author_id ∩ Faculty.scopus_id (co-authored papers)
 */

/**
 * Derive kerberos from a faculty email (the part before @).
 * @param {string|undefined} email
 * @returns {string|null}
 */
export function kerberosFromEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const k = email.split('@')[0].trim().toLowerCase();
  return k || null;
}

/**
 * @param {object} faculty - Faculty document with email and optional scopus_id array
 * @returns {object} MongoDB filter for ResearchMetaDataScopus.find(...)
 */
export function papersMongoFilterForFaculty(faculty) {
  const scopusIds = (faculty?.scopus_id || []).map(String).filter(Boolean);
  const kerberos = kerberosFromEmail(faculty?.email);

  const conditions = [];
  if (kerberos) conditions.push({ kerberos });
  if (scopusIds.length) conditions.push({ "authors.author_id": { $in: scopusIds } });

  if (conditions.length === 0) return { document_eid: { $in: [] } };
  if (conditions.length === 1) return conditions[0];
  return { $or: conditions };
}

/**
 * Look up a Faculty document from a paper's kerberos field.
 * @param {string} kerberos - kerberos ID from the paper
 * @param {import('mongoose').Model} FacultyModel
 * @returns {Promise<object|null>}
 */
export async function facultyFromKerberos(kerberos, FacultyModel) {
  if (!kerberos || typeof kerberos !== 'string') return null;
  const k = kerberos.trim().toLowerCase();
  if (!k) return null;
  return FacultyModel.findOne({ email: new RegExp(`^${k}@`, 'i') }).lean();
}
