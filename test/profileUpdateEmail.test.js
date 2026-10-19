import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildProfileUpdateEmail, describeActors, describeProfileChanges, snapshotProfile, snapshotsEqual,
} from '../src/services/profileUpdateEmail.js';
import { actorFromRequest, resolveRecipient } from '../src/services/profileUpdateNotifier.js';

const base = {
    title: 'Prof.', firstName: 'A', lastName: 'B',
    metric_visibility: { h_index: true },
    background: 'Old text',
    qualifications: ['B.Tech'],
    phone: '123',
    external_links: [{ label: 'Lab', url: 'https://lab.example.org' }],
};

test('unchanged and default-equivalent profiles produce equal snapshots', () => {
    assert.ok(snapshotsEqual(snapshotProfile(base), snapshotProfile({ ...base })));
    assert.ok(snapshotsEqual(snapshotProfile({}), snapshotProfile({ metric_visibility: {}, background_visible: false })));
    assert.deepEqual(describeProfileChanges(base, base), []);
});

test('a change that was undone within the session is not reported', () => {
    const toggledBack = { ...base, metric_visibility: { h_index: true } };
    assert.deepEqual(describeProfileChanges(base, toggledBack), []);
});

test('describes every kind of change by section', () => {
    const after = {
        ...base,
        profile_image_url: 'https://cdn.example.org/new.jpg',
        metric_visibility: { h_index: false },
        background: 'New text about research',
        background_visible: true,
        qualifications: ['b.tech', 'Ph.D.'],
        phone: '',
        external_links: [{ label: 'Group', url: 'https://lab.example.org' }, { label: 'Scholar', url: 'https://scholar.example.org' }],
    };
    const sections = Object.fromEntries(describeProfileChanges(base, after).map((s) => [s.title, s]));

    const types = (title) => sections[title].changes.map((c) => c.type);

    assert.equal(sections['Profile photo'].imageUrl, 'https://cdn.example.org/new.jpg');
    assert.deepEqual(types('Research metrics'), ['hidden']);
    assert.equal(sections.Background.quote, 'New text about research');
    assert.deepEqual(types('Background'), ['shown', 'updated']);
    assert.deepEqual(sections.Qualifications.changes, [{ type: 'added', text: 'Ph.D.' }]);
    assert.deepEqual(sections['Contact number'].changes, [{ type: 'removed', text: '123' }]);
    assert.deepEqual(sections['External links'].changes.map((c) => [c.type, c.from, c.to]), [
        ['changed', 'Lab', 'Group'],
        ['added', undefined, undefined],
    ]);
});

test('legacy http Cloudinary photos are shown over https', () => {
    const url = 'http://res.cloudinary.com/demo/image/upload/v1/faculty_images/x.jpg';
    const email = buildProfileUpdateEmail({
        name: 'Prof. A B', kerberos: 'abc', sections: describeProfileChanges(base, { ...base, profile_image_url: url }),
        actors: [{ kind: 'self' }], firstChangeAt: new Date(), lastChangeAt: new Date(),
        profileUrl: 'https://researchambit.iitd.ac.in/faculty/abc', photoUrl: url,
    });
    assert.ok(email.html.includes('https://res.cloudinary.com/demo/image/upload/c_fill,g_face,w_176,h_176,q_auto,f_auto/v1/faculty_images/x.jpg'));
    assert.ok(!email.html.includes('http://res.cloudinary.com'));
});

test('actor wording distinguishes self edits from team edits', () => {
    assert.match(describeActors([{ kind: 'self' }], 'abc'), /your IITD account \(abc\)/);
    assert.match(describeActors([{ kind: 'superadmin' }], 'abc'), /Research Ambit team on your behalf/);
    assert.match(describeActors([{ kind: 'self' }, { kind: 'superadmin' }], 'abc'), /Some were made/);
});

test('actorFromRequest treats a superadmin editing their own profile as self', () => {
    const req = (kerberos, role) => ({ headers: { 'x-user-kerberos': kerberos, 'x-user-role': role } });
    assert.deepEqual(actorFromRequest(req('abc', 'user'), 'abc'), { kind: 'self', id: 'abc' });
    assert.deepEqual(actorFromRequest(req('admin1', 'superadmin'), 'abc'), { kind: 'superadmin', id: 'admin1' });
    assert.deepEqual(actorFromRequest(req('abc', 'superadmin'), 'abc'), { kind: 'self', id: 'abc' });
});

test('only MAIL_PROD=true sends to the faculty address', () => {
    const saved = { prod: process.env.MAIL_PROD, dev: process.env.MAIL_DEV_TO };
    try {
        delete process.env.MAIL_DEV_TO;
        for (const value of [undefined, 'false', '1', 'TRUE', 'yes']) {
            if (value === undefined) delete process.env.MAIL_PROD;
            else process.env.MAIL_PROD = value;
            assert.deepEqual(resolveRecipient('abc'), { to: 'ch7221511@iitd.ac.in', redirectedFrom: 'abc@iitd.ac.in' });
        }
        process.env.MAIL_PROD = 'true';
        assert.deepEqual(resolveRecipient('abc'), { to: 'abc@iitd.ac.in' });
    } finally {
        if (saved.prod === undefined) delete process.env.MAIL_PROD; else process.env.MAIL_PROD = saved.prod;
        if (saved.dev !== undefined) process.env.MAIL_DEV_TO = saved.dev;
    }
});

test('email escapes faculty-entered text and marks dev redirects', () => {
    const sections = describeProfileChanges(base, { ...base, qualifications: ['B.Tech', '<script>x</script>'] });
    const email = buildProfileUpdateEmail({
        name: 'Prof. A B', kerberos: 'abc', sections, actors: [{ kind: 'self' }],
        firstChangeAt: new Date(), lastChangeAt: new Date(),
        profileUrl: 'https://researchambit.iitd.ac.in/faculty/abc', devRedirectedFrom: 'abc@iitd.ac.in',
    });
    assert.ok(!email.html.includes('<script>'));
    assert.ok(email.html.includes('&lt;script&gt;'));
    assert.equal(email.subject, '[DEV → abc@iitd.ac.in] Your Research Ambit profile was updated');
    assert.match(email.text, /Added: <script>x<\/script>/);
    assert.match(email.text, /just reply to this email or write to support\.rambit@iitd\.ac\.in/i);
    assert.ok(email.html.includes('href="mailto:support.rambit@iitd.ac.in?subject=Profile%20update%20query%20(abc)"'));
    assert.ok(email.html.includes('cid:iitd-seal@researchambit'));
    assert.ok(email.attachments[0].path.endsWith('assets/email/iitd-seal.png'));
});
