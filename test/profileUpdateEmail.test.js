import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildProfileUpdateEmail, describeActors, describeProfileChanges, snapshotProfile, snapshotsEqual,
} from '../src/services/profileUpdateEmail.js';
import { actorFromRequest, guardRecipient, isSuperadminEdit, isSuperadminOnlyNotice, resolveRecipient } from '../src/services/profileUpdateNotifier.js';
import { smtpServer } from '../src/lib/mailTransport.js';
import { suggestionRecipient } from '../src/utils/mailer.js';

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

test('a superadmin editing someone else does not send a profile email', () => {
    assert.equal(isSuperadminEdit({ kind: 'superadmin', id: 'admin1' }), true);
    assert.equal(isSuperadminEdit({ kind: 'self', id: 'abc' }), false);
    assert.equal(isSuperadminOnlyNotice([{ kind: 'superadmin', id: 'admin1' }]), true);
    assert.equal(isSuperadminOnlyNotice([{ kind: 'self', id: 'abc' }, { kind: 'superadmin', id: 'admin1' }]), false);
    assert.equal(isSuperadminOnlyNotice([]), false);
});

test('only MAIL_PROD=true sends to the faculty address', () => {
    const saved = { prod: process.env.MAIL_PROD, dev: process.env.MAIL_DEV_TO };
    try {
        delete process.env.MAIL_DEV_TO;
        for (const value of [undefined, 'false', '1', 'TRUE', 'yes']) {
            if (value === undefined) delete process.env.MAIL_PROD;
            else process.env.MAIL_PROD = value;
            assert.deepEqual(resolveRecipient('abc', 'abc@chemical.iitd.ac.in'), { to: 'ch7221511@iitd.ac.in', redirectedFrom: 'abc@chemical.iitd.ac.in' });
        }
        process.env.MAIL_PROD = 'true';
        assert.deepEqual(resolveRecipient('abc', 'ABC@chemical.iitd.ac.in'), { to: 'abc@chemical.iitd.ac.in' });
        assert.deepEqual(resolveRecipient('abc', 'abc@iitd.ac.in'), { to: 'abc@iitd.ac.in' });
        assert.deepEqual(resolveRecipient('abc', 'abc@gmail.com'), { to: 'abc@iitd.ac.in' });
        assert.deepEqual(resolveRecipient('abc', 'abc@iitd.ac.in.evil.com'), { to: 'abc@iitd.ac.in' });
        assert.deepEqual(resolveRecipient('abc', ''), { to: 'abc@iitd.ac.in' });
    } finally {
        if (saved.prod === undefined) delete process.env.MAIL_PROD; else process.env.MAIL_PROD = saved.prod;
        if (saved.dev !== undefined) process.env.MAIL_DEV_TO = saved.dev;
    }
});

test('nothing reaches a faculty address unless MAIL_PROD=true', () => {
    const saved = { prod: process.env.MAIL_PROD, dev: process.env.MAIL_DEV_TO };
    const restore = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    try {
        delete process.env.MAIL_PROD;
        delete process.env.MAIL_DEV_TO;
        assert.equal(guardRecipient('ch7221511@iitd.ac.in'), 'ch7221511@iitd.ac.in');
        assert.throws(() => guardRecipient('akshi@chemical.iitd.ac.in'), /MAIL_PROD/);
        process.env.MAIL_PROD = 'true';
        assert.equal(guardRecipient('Akshi@Chemical.iitd.ac.in'), 'akshi@chemical.iitd.ac.in');
        assert.throws(() => guardRecipient('akshi@gmail.com'), /IIT Delhi/);
        assert.throws(() => guardRecipient(''), /IIT Delhi/);
    } finally {
        restore('MAIL_PROD', saved.prod);
        restore('MAIL_DEV_TO', saved.dev);
    }
});

test('suggestion emails stay in the dev inbox outside production', () => {
    const saved = { to: process.env.MAIL_TO, env: process.env.NODE_ENV, dev: process.env.MAIL_DEV_TO };
    const restore = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    try {
        delete process.env.MAIL_TO;
        delete process.env.MAIL_DEV_TO;
        process.env.NODE_ENV = 'development';
        assert.equal(suggestionRecipient(), 'ch7221511@iitd.ac.in');
        process.env.NODE_ENV = 'production';
        assert.equal(suggestionRecipient(), 'researchambit@iitd.ac.in');
        process.env.MAIL_TO = 'team@iitd.ac.in';
        assert.equal(suggestionRecipient(), 'team@iitd.ac.in');
    } finally {
        restore('MAIL_TO', saved.to);
        restore('NODE_ENV', saved.env);
        restore('MAIL_DEV_TO', saved.dev);
    }
});

test('IITD SMTP is used unless overridden outside production', () => {
    const saved = { host: process.env.MAIL_HOST, port: process.env.MAIL_PORT, env: process.env.NODE_ENV };
    const restore = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    try {
        delete process.env.MAIL_HOST;
        delete process.env.MAIL_PORT;
        assert.deepEqual(smtpServer(), { host: 'smtp.iitd.ac.in', port: 465, secure: true });

        process.env.MAIL_HOST = 'smtp.gmail.com';
        process.env.MAIL_PORT = '587';
        process.env.NODE_ENV = 'production';
        assert.deepEqual(smtpServer(), { host: 'smtp.iitd.ac.in', port: 465, secure: true });

        process.env.NODE_ENV = 'development';
        assert.deepEqual(smtpServer(), { host: 'smtp.gmail.com', port: 587, secure: false });
    } finally {
        restore('MAIL_HOST', saved.host);
        restore('MAIL_PORT', saved.port);
        restore('NODE_ENV', saved.env);
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
