import test from 'node:test';
import assert from 'node:assert/strict';

import Faculty from '../src/models/faculty.js';
import {
    autoResearchAreasWithState,
    formatDirectoryFaculty,
    formatDominantDomains,
    mergeResearchAreas,
    visibleDominantDomains,
} from '../src/domain/facultyDirectory.js';
import { describeProfileChanges, snapshotProfile, snapshotsEqual } from '../src/services/profileUpdateEmail.js';

const domains = [
    { domain_id: 'd1', name: 'Process Systems Engineering', slug: 'process-systems-engineering', paper_count: 40 },
    { domain_id: 'd2', name: 'Machine Learning', slug: 'machine-learning', paper_count: 25 },
    { domain_id: 'd3', name: 'Catalysis', slug: 'catalysis', paper_count: 9 },
];

const doc = (extra = {}) => ({
    expert_id: 'e1',
    title: 'Prof.',
    firstName: 'Test',
    lastName: 'Person',
    email: 'test@iitd.ac.in',
    expertise: ['Control Theory'],
    dominant_domains: domains,
    ...extra,
});

test('with nothing hidden every auto-assigned area is public (existing behaviour)', () => {
    assert.deepEqual(visibleDominantDomains(doc()).map((d) => d.slug), domains.map((d) => d.slug));
    assert.deepEqual(visibleDominantDomains(doc({ hidden_research_area_slugs: [] })).length, 3);
});

test('hidden areas disappear from the public domain list and research_areas', () => {
    const d = doc({ hidden_research_area_slugs: ['machine-learning'] });
    assert.deepEqual(formatDominantDomains(d).map((x) => x.slug), ['process-systems-engineering', 'catalysis']);
    const merged = mergeResearchAreas(d, new Map());
    assert.ok(!merged.includes('Machine Learning'));
    assert.ok(merged.includes('Process Systems Engineering'));
    assert.ok(merged.includes('Control Theory'));
});

test('visible areas keep their name, slug and paperCount so they stay clickable', () => {
    const [first] = formatDominantDomains(doc({ hidden_research_area_slugs: ['catalysis'] }));
    assert.deepEqual(first, { name: 'Process Systems Engineering', slug: 'process-systems-engineering', paperCount: 40 });
});

test('hiding never mutates the computed dominant_domains', () => {
    const d = doc({ hidden_research_area_slugs: ['catalysis'] });
    formatDominantDomains(d);
    assert.equal(d.dominant_domains.length, 3);
});

test('the full directory payload honours hidden areas', () => {
    const out = formatDirectoryFaculty(doc({ hidden_research_area_slugs: ['catalysis'] }), new Map(), { department: null });
    assert.deepEqual(out.dominant_domains.map((x) => x.slug), ['process-systems-engineering', 'machine-learning']);
});

test('the owner view lists every area with its hidden flag', () => {
    const d = doc({ hidden_research_area_slugs: ['machine-learning'] });
    assert.deepEqual(autoResearchAreasWithState(d), [
        { name: 'Process Systems Engineering', slug: 'process-systems-engineering', hidden: false },
        { name: 'Machine Learning', slug: 'machine-learning', hidden: true },
        { name: 'Catalysis', slug: 'catalysis', hidden: false },
    ]);
});

test('a stale hidden slug (domain recomputed away) is ignored, not an error', () => {
    const d = doc({ hidden_research_area_slugs: ['no-longer-a-domain'] });
    assert.equal(formatDominantDomains(d).length, 3);
    assert.equal(autoResearchAreasWithState(d).every((a) => !a.hidden), true);
});

test('schema caps the hidden list and slug length', () => {
    const base = {
        expert_id: 'x', experience_id: 'x', title: 'Prof.', firstName: 'A', lastName: 'B',
        email: 'a@iitd.ac.in', gender: 'Other', department: '507f1f77bcf86cd799439011',
    };
    assert.equal(new Faculty({ ...base, hidden_research_area_slugs: Array(20).fill('a') }).validateSync(), undefined);
    assert.ok(new Faculty({ ...base, hidden_research_area_slugs: Array(21).fill('a') }).validateSync()?.errors.hidden_research_area_slugs);
    assert.ok(new Faculty({ ...base, hidden_research_area_slugs: ['x'.repeat(121)] }).validateSync());
});

test('email summary reports hiding and showing an auto-assigned area', () => {
    const before = doc();
    const hidden = doc({ hidden_research_area_slugs: ['machine-learning', 'catalysis'] });
    const sections = describeProfileChanges(snapshotProfile(before), snapshotProfile(hidden));
    const s = sections.find((x) => x.title === 'Auto-assigned research areas');
    assert.deepEqual(s.changes.map((c) => c.type).sort(), ['hidden', 'hidden']);
    assert.ok(s.changes.some((c) => c.text === 'Machine Learning is now hidden from your public profile'));

    const back = describeProfileChanges(snapshotProfile(hidden), snapshotProfile(doc({ hidden_research_area_slugs: ['catalysis'] })));
    const s2 = back.find((x) => x.title === 'Auto-assigned research areas');
    assert.deepEqual(s2.changes, [{ type: 'shown', text: 'Machine Learning is now shown on your public profile' }]);
});

test('profiles with no hidden areas still snapshot as equal (no spurious emails)', () => {
    assert.ok(snapshotsEqual(snapshotProfile(doc()), snapshotProfile(doc({ hidden_research_area_slugs: [] }))));
    assert.equal(describeProfileChanges(snapshotProfile(doc()), snapshotProfile(doc())).length, 0);
});
