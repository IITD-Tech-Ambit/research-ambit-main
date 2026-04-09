/**
 * ResearchMetaDataScopus no longer stores expert_id.
 * Link papers to faculty via intersection of paper.authors[].author_id and Faculty.scopus_id.
 */

/**
 * @param {object} faculty - Faculty document with optional scopus_id array
 * @returns {object} MongoDB filter for ResearchMetaDataScopus.find(...)
 */
export function papersMongoFilterForFaculty(faculty) {
  const ids = (faculty?.scopus_id || []).map(String).filter(Boolean);
  if (!ids.length) {
    return { document_eid: { $in: [] } };
  }
  return { "authors.author_id": { $in: ids } };
}
