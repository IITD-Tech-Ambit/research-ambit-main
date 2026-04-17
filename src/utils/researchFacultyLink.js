/**
 * Papers (ResearchMetaDataScopus) are linked to a Faculty via EITHER:
 *   1. paper.authors[].author_id ∩ Faculty.scopus_id, OR
 *   2. paper.kerberos === kerberos(Faculty.email)   (top-level field stamped by the
 *      OpenSearch ingest pipeline for IIT Delhi faculty whose Scopus authors are
 *      external collaborators — they'd otherwise be orphaned by the scopus-only join).
 *
 * Both mind-map expansion (`getResearchByFaculty`) and the open-path resolver rely on
 * this filter — using scopus-only here caused mind-map paths to not highlight when the
 * paper was linked by kerberos only.
 */

const kerberosFromEmail = (email) => {
  if (typeof email !== "string") return null;
  const prefix = email.split("@")[0]?.trim().toLowerCase();
  return prefix || null;
};

/**
 * @param {object} faculty - Faculty document with `scopus_id` array and/or `email`
 * @returns {object} MongoDB filter for ResearchMetaDataScopus.find(...)
 */
export function papersMongoFilterForFaculty(faculty) {
  const scopusIds = (faculty?.scopus_id || []).map(String).filter(Boolean);
  const kerberos = kerberosFromEmail(faculty?.email);

  const clauses = [];
  if (scopusIds.length) {
    clauses.push({ "authors.author_id": { $in: scopusIds } });
  }
  if (kerberos) {
    clauses.push({ kerberos });
  }

  if (!clauses.length) {
    return { document_eid: { $in: [] } };
  }
  if (clauses.length === 1) {
    return clauses[0];
  }
  return { $or: clauses };
}
