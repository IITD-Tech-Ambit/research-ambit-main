/**
 * Pure helpers for the "your profile was updated" email: snapshot the
 * faculty-editable fields, describe what changed between two snapshots, and
 * render the email. No I/O apart from resolving the seal asset path, so it is
 * unit-tested directly.
 */
import { fileURLToPath } from 'url';

const METRICS = [
    ['h_index', 'H-index'],
    ['citations', 'Citations'],
    ['papers', 'Papers'],
    ['patents', 'Patents'],
];

const SECTIONS = [
    { key: 'background', title: 'Background', type: 'text', visibleKey: 'background_visible' },
    { key: 'qualifications', title: 'Qualifications', type: 'list', visibleKey: 'qualifications_visible' },
    { key: 'awards', title: 'Awards & Honors', type: 'list', visibleKey: 'awards_visible' },
    { key: 'custom_research_areas', title: 'Research areas', type: 'list' },
    { key: 'additional_emails', title: 'Additional email addresses', type: 'list' },
    { key: 'phone', title: 'Contact number', type: 'value', visibleKey: 'phone_visible' },
    { key: 'office_address', title: 'Office address', type: 'value', visibleKey: 'office_address_visible' },
    { key: 'external_links', title: 'External links', type: 'links', visibleKey: 'external_links_visible' },
];

const EXCERPT_CHARS = 280;

const strList = (value) => (Array.isArray(value) ? value.map((v) => String(v ?? '')).filter(Boolean) : []);

export const facultyDisplayName = (doc = {}) =>
    [doc.title, doc.firstName, doc.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/** The faculty-editable fields of a Faculty doc, normalised so two snapshots
 * of an unchanged profile are always deep-equal. */
export const snapshotProfile = (doc = {}) => {
    const vis = doc.metric_visibility || {};
    return {
        profile_image_url: doc.profile_image_url || '',
        metric_visibility: Object.fromEntries(METRICS.map(([k]) => [k, vis[k] !== false])),
        background: doc.background || '',
        background_visible: doc.background_visible === true,
        qualifications: strList(doc.qualifications),
        qualifications_visible: doc.qualifications_visible === true,
        awards: strList(doc.awards),
        awards_visible: doc.awards_visible === true,
        custom_research_areas: strList(doc.custom_research_areas),
        additional_emails: strList(doc.additional_emails),
        phone: doc.phone || '',
        phone_visible: doc.phone_visible === true,
        office_address: doc.office_address || '',
        office_address_visible: doc.office_address_visible === true,
        external_links: Array.isArray(doc.external_links)
            ? doc.external_links.map((l) => ({ label: String(l?.label || ''), url: String(l?.url || '') }))
            : [],
        external_links_visible: doc.external_links_visible === true,
    };
};

export const snapshotsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const excerpt = (text) => {
    const clean = String(text).replace(/\s+/g, ' ').trim();
    return clean.length > EXCERPT_CHARS ? `${clean.slice(0, EXCERPT_CHARS).trimEnd()}…` : clean;
};

const listDiff = (before, after) => {
    const lower = (xs) => new Set(xs.map((x) => x.toLowerCase()));
    const b = lower(before);
    const a = lower(after);
    return {
        added: after.filter((x) => !b.has(x.toLowerCase())),
        removed: before.filter((x) => !a.has(x.toLowerCase())),
    };
};

const visibilityChange = (nowVisible) =>
    nowVisible
        ? { type: 'shown', text: 'Section is now shown on your public profile' }
        : { type: 'hidden', text: 'Section is now hidden from your public profile' };

/**
 * Changes between two snapshots, grouped by profile section:
 * [{ title, changes: [{ type, text, from?, to? }], imageUrl?, previousImageUrl?, quote? }]
 * where type is added | removed | changed | updated | shown | hidden.
 * Empty when nothing net changed.
 */
export const describeProfileChanges = (baseline = {}, latest = {}) => {
    const b = snapshotProfile(baseline);
    const a = snapshotProfile(latest);
    const sections = [];

    if (b.profile_image_url !== a.profile_image_url) {
        sections.push(
            a.profile_image_url
                ? {
                    title: 'Profile photo',
                    changes: [{ type: 'updated', text: b.profile_image_url ? 'Your profile photo was replaced' : 'A profile photo was added' }],
                    imageUrl: a.profile_image_url,
                    ...(b.profile_image_url ? { previousImageUrl: b.profile_image_url } : {}),
                }
                : { title: 'Profile photo', changes: [{ type: 'removed', text: 'Your profile photo was removed' }] },
        );
    }

    const metricChanges = METRICS
        .filter(([k]) => b.metric_visibility[k] !== a.metric_visibility[k])
        .map(([k, label]) => (a.metric_visibility[k]
            ? { type: 'shown', text: `${label} is now shown on your public profile` }
            : { type: 'hidden', text: `${label} is now hidden from your public profile` }));
    if (metricChanges.length) sections.push({ title: 'Research metrics', changes: metricChanges });

    for (const s of SECTIONS) {
        const changes = [];
        let quote;
        const before = b[s.key];
        const after = a[s.key];

        if (s.visibleKey && b[s.visibleKey] !== a[s.visibleKey]) changes.push(visibilityChange(a[s.visibleKey]));

        if (s.type === 'text' && before !== after) {
            if (!after.trim()) changes.push({ type: 'removed', text: 'The text was removed' });
            else {
                changes.push({ type: before.trim() ? 'updated' : 'added', text: before.trim() ? 'The text was updated. It now reads:' : 'Text was added:' });
                quote = excerpt(after);
            }
        } else if (s.type === 'list') {
            const { added, removed } = listDiff(before, after);
            added.forEach((x) => changes.push({ type: 'added', text: x }));
            removed.forEach((x) => changes.push({ type: 'removed', text: x }));
        } else if (s.type === 'value' && before !== after) {
            if (!before) changes.push({ type: 'added', text: after });
            else if (!after) changes.push({ type: 'removed', text: before });
            else changes.push({ type: 'changed', text: `${before} → ${after}`, from: before, to: after });
        } else if (s.type === 'links') {
            const byUrl = (xs) => new Map(xs.map((l) => [l.url.toLowerCase(), l]));
            const bm = byUrl(before);
            const am = byUrl(after);
            for (const [key, l] of am) {
                const old = bm.get(key);
                if (!old) changes.push({ type: 'added', text: `${l.label} (${l.url})` });
                else if (old.label !== l.label) {
                    changes.push({ type: 'changed', text: `"${old.label}" → "${l.label}" (${l.url})`, from: old.label, to: l.label, note: l.url });
                }
            }
            for (const [key, l] of bm) if (!am.has(key)) changes.push({ type: 'removed', text: `${l.label} (${l.url})` });
        }

        if (changes.length) sections.push({ title: s.title, changes, ...(quote ? { quote } : {}) });
    }

    return sections;
};

const IST = 'Asia/Kolkata';
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

export const describeWhen = (first, last) => {
    const start = new Date(first);
    const end = new Date(last || first);
    if (end - start < 60_000) return `on ${fmtDate(start)} at ${fmtTime(start)} IST`;
    if (fmtDate(start) === fmtDate(end)) return `on ${fmtDate(start)} between ${fmtTime(start)} and ${fmtTime(end)} IST`;
    return `between ${fmtDate(start)}, ${fmtTime(start)} and ${fmtDate(end)}, ${fmtTime(end)} IST`;
};

export const describeActors = (actors = [], kerberos = '') => {
    const self = actors.some((a) => a.kind === 'self');
    const team = actors.some((a) => a.kind === 'superadmin');
    if (self && team) return `Some were made while signed in with your IITD account (${kerberos}) and some by the Research Ambit team.`;
    if (team) return 'They were made by the Research Ambit team on your behalf.';
    return `They were made while signed in with your IITD account (${kerberos}).`;
};

const actorBadge = (actors = []) => {
    const self = actors.some((a) => a.kind === 'self');
    const team = actors.some((a) => a.kind === 'superadmin');
    if (self && team) return 'By you and the Research Ambit team';
    if (team) return 'By the Research Ambit team';
    return 'From your IITD account';
};

const CHANGE_LABEL = {
    added: 'Added', removed: 'Removed', changed: 'Changed', updated: 'Updated', shown: 'Shown', hidden: 'Hidden',
};

const changeToText = (c) => {
    if (c.type === 'shown' || c.type === 'hidden' || c.type === 'updated') return c.text;
    return `${CHANGE_LABEL[c.type]}: ${c.text}`;
};

const escapeHtml = (str = '') =>
    String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const initialsOf = (name = '') => {
    const words = name.replace(/^(prof|dr|mr|ms|mrs)\.?\s+/i, '').split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '?';
};

/** A small square, face-centred rendition for Cloudinary URLs; others unchanged. */
const thumbnail = (url, size) =>
    /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)
        ? url.replace('/image/upload/', `/image/upload/c_fill,g_face,w_${size * 2},h_${size * 2},q_auto,f_auto/`)
        : url;

const safeImage = (url) => /^https:\/\//i.test(url || '');

export const SEAL_CID = 'iitd-seal@researchambit';
export const sealAttachment = () => ({
    filename: 'iitd-seal.png',
    path: fileURLToPath(new URL('../../assets/email/iitd-seal.png', import.meta.url)),
    cid: SEAL_CID,
    contentDisposition: 'inline',
});

const SUBJECT = 'Your Research Ambit profile was updated';
const REPLY_TITLE = "Don't recognise these changes?";
const REPLY_BODY = "If you didn't make them, or something on your profile looks wrong, just reply to this email and the Research Ambit team will look into it.";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
// Long URLs and email addresses must wrap instead of widening the layout on phones.
const WRAP = 'word-break:break-word;overflow-wrap:anywhere;';
const C = {
    primary: '#1b54da', primaryDark: '#163fa8', accent: '#22c3be', ink: '#0f172a', body: '#334155',
    muted: '#64748b', faint: '#94a3b8', line: '#e2e8f0', canvas: '#eef2f8', card: '#ffffff', soft: '#f8fafc',
};
const CHIP = {
    added: ['#ecfdf5', '#047857'],
    removed: ['#fef2f2', '#b91c1c'],
    changed: ['#eff6ff', '#1d4ed8'],
    updated: ['#eff6ff', '#1d4ed8'],
    shown: ['#f0fdfa', '#0f766e'],
    hidden: ['#f1f5f9', '#475569'],
};

const chip = (type) => {
    const [bg, fg] = CHIP[type] || CHIP.updated;
    return `<span style="display:inline-block;font-family:${FONT};background:${bg};color:${fg};border-radius:999px;padding:3px 10px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.3px;white-space:nowrap;">${CHANGE_LABEL[type]}</span>`;
};

const changeRowHtml = (c) => {
    let body;
    if (c.type === 'changed' && c.from !== undefined) {
        body = `<span style="color:${C.faint};text-decoration:line-through;">${escapeHtml(c.from)}</span>`
            + `<span style="color:${C.faint};">&nbsp;&nbsp;&rarr;&nbsp;&nbsp;</span>`
            + `<strong style="color:${C.ink};font-weight:600;">${escapeHtml(c.to)}</strong>`
            + (c.note ? `<br /><span style="font-size:12px;color:${C.muted};">${escapeHtml(c.note)}</span>` : '');
    } else {
        body = escapeHtml(c.text);
    }
    return `
                    <tr>
                      <td class="chip-col" valign="top" width="86" style="width:86px;padding:5px 0;">${chip(c.type)}</td>
                      <td valign="top" style="padding:5px 0 5px 4px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};${WRAP}">${body}</td>
                    </tr>`;
};

const photoHtml = (s) => {
    if (!safeImage(s.imageUrl)) return '';
    const img = (url, alt, dim) => `<img src="${escapeHtml(thumbnail(url, 88))}" alt="${alt}" width="88" height="88" style="display:block;width:88px;height:88px;border-radius:18px;object-fit:cover;border:1px solid ${C.line};${dim ? 'opacity:0.55;' : ''}" />`;
    const caption = (t) => `<p style="margin:6px 0 0;font-family:${FONT};font-size:11px;line-height:14px;color:${C.faint};text-align:center;text-transform:uppercase;letter-spacing:0.6px;">${t}</p>`;
    const before = safeImage(s.previousImageUrl)
        ? `<td valign="middle" style="padding:0;">${img(s.previousImageUrl, 'Previous photo', true)}${caption('Before')}</td>
                        <td valign="middle" style="padding:0 14px 18px;font-family:${FONT};font-size:20px;color:${C.faint};">&rarr;</td>`
        : '';
    return `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 10px;">
                  <tr>
                    ${before}
                    <td valign="middle" style="padding:0;">${img(s.imageUrl, 'New photo', false)}${caption(before ? 'After' : 'New photo')}</td>
                  </tr>
                </table>`;
};

const sectionHtml = (s, isLast) => `
            <tr>
              <td style="padding:20px 0;${isLast ? '' : `border-bottom:1px solid ${C.line};`}">
                <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${C.primary};">${escapeHtml(s.title)}</p>
                ${photoHtml(s)}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${s.changes.map(changeRowHtml).join('')}
                </table>
                ${s.quote ? `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
                  <tr><td style="background:${C.soft};border-left:3px solid ${C.accent};border-radius:6px;padding:12px 16px;font-family:Georgia,'Times New Roman',serif;font-size:14px;line-height:23px;color:${C.body};font-style:italic;${WRAP}">&ldquo;${escapeHtml(s.quote)}&rdquo;</td></tr>
                </table>` : ''}
              </td>
            </tr>`;

const sectionList = (titles) =>
    titles.length <= 2 ? titles.join(' and ') : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;

/**
 * @param {{ name: string, kerberos: string, sections: ReturnType<typeof describeProfileChanges>,
 *   actors: {kind: string}[], firstChangeAt: Date, lastChangeAt: Date, profileUrl: string,
 *   photoUrl?: string, sealSrc?: string, devRedirectedFrom?: string }} input
 *   photoUrl = the faculty's current photo; sealSrc = image source for the IIT Delhi
 *   seal (defaults to the inline attachment); devRedirectedFrom = the real
 *   recipient, when the mail is being redirected to the dev inbox instead.
 */
export const buildProfileUpdateEmail = ({
    name, kerberos, sections, actors, firstChangeAt, lastChangeAt, profileUrl, photoUrl, sealSrc = `cid:${SEAL_CID}`, devRedirectedFrom,
}) => {
    const displayName = name || kerberos;
    const when = describeWhen(firstChangeAt, lastChangeAt);
    const actorLine = describeActors(actors, kerberos);
    const subject = devRedirectedFrom ? `[DEV → ${devRedirectedFrom}] ${SUBJECT}` : SUBJECT;
    const titles = sections.map((s) => s.title);
    const changeCount = sections.reduce((n, s) => n + s.changes.length, 0);
    const preheader = `Changes to ${sectionList(titles)}. Didn't make them? Just reply to this email.`;

    const text = [
        ...(devRedirectedFrom ? [`[DEV] In production this email would be sent to ${devRedirectedFrom}.`, ''] : []),
        `Dear ${displayName},`,
        '',
        `The following changes were made to your faculty profile on Research Ambit ${when}. ${actorLine}`,
        '',
        ...sections.flatMap((s) => [
            s.title.toUpperCase(),
            ...s.changes.map((c) => `  - ${changeToText(c)}`),
            ...(s.quote ? [`    "${s.quote}"`] : []),
            ...(s.imageUrl ? [`    New photo: ${s.imageUrl}`] : []),
            '',
        ]),
        `View your profile: ${profileUrl}`,
        '',
        `${REPLY_TITLE} ${REPLY_BODY}`,
        '',
        '—',
        'Research Ambit · Indian Institute of Technology Delhi',
        'This is an automated notice, sent whenever your faculty profile on Research Ambit changes.',
    ].join('\n');

    const avatar = safeImage(photoUrl)
        ? `<img src="${escapeHtml(thumbnail(photoUrl, 56))}" alt="" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:14px;object-fit:cover;border:1px solid ${C.line};" />`
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="56" height="56" align="center" valign="middle" bgcolor="${C.primary}" style="width:56px;height:56px;border-radius:14px;background:${C.primary};background-image:linear-gradient(135deg,${C.primary},${C.accent});font-family:${FONT};font-size:20px;font-weight:700;color:#ffffff;">${escapeHtml(initialsOf(displayName))}</td></tr></table>`;

    const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(SUBJECT)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .outer { padding: 16px 8px 28px !important; }
      .card { border-radius: 14px !important; }
      .px { padding-left: 20px !important; padding-right: 20px !important; }
      .hero { padding-top: 26px !important; }
      .hero-title { font-size: 23px !important; line-height: 29px !important; }
      .chip-col { width: 74px !important; }
      .btn-table { width: 100% !important; }
      .btn-link { display: block !important; text-align: center !important; }
    }
    a { color: ${C.primary}; }
  </style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};">
    <tr><td class="outer" align="center" style="padding:32px 12px 40px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
        ${devRedirectedFrom ? `
        <tr><td style="padding:0 0 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:#fffbeb;border:1px dashed #f59e0b;border-radius:10px;padding:10px 16px;font-family:${FONT};font-size:13px;line-height:19px;color:#92400e;${WRAP}">
              <strong>Dev preview</strong> &middot; in production this goes to <strong>${escapeHtml(devRedirectedFrom)}</strong>
            </td>
          </tr></table>
        </td></tr>` : ''}

        <tr><td style="padding:0 4px 18px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="padding-right:12px;"><img src="${escapeHtml(sealSrc)}" alt="IIT Delhi" width="40" height="39" style="display:block;width:40px;height:39px;border:0;" /></td>
            <td valign="middle" style="font-family:${FONT};">
              <p style="margin:0;font-size:17px;line-height:21px;font-weight:700;color:${C.ink};letter-spacing:-0.2px;">Research Ambit</p>
              <p style="margin:1px 0 0;font-size:12px;line-height:16px;color:${C.muted};">Indian Institute of Technology Delhi</p>
            </td>
          </tr></table>
        </td></tr>

        <tr><td class="card" style="background:${C.card};border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,0.08);overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td height="5" bgcolor="${C.primary}" style="height:5px;line-height:5px;font-size:0;background:${C.primary};background-image:linear-gradient(90deg,${C.primary},${C.accent});border-radius:18px 18px 0 0;">&nbsp;</td></tr>

            <tr><td class="px hero" style="padding:34px 40px 8px;font-family:${FONT};">
              <p style="margin:0 0 10px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.accent};">Profile update</p>
              <h1 class="hero-title" style="margin:0;font-size:27px;line-height:34px;font-weight:700;color:${C.ink};letter-spacing:-0.4px;">Your profile was updated</h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:24px;color:${C.body};">Dear ${escapeHtml(displayName)}, here&rsquo;s a summary of the changes made to your faculty profile ${escapeHtml(when)}.</p>
            </td></tr>

            <tr><td class="px" style="padding:22px 40px 6px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border:1px solid ${C.line};border-radius:14px;">
                <tr>
                  <td width="56" valign="middle" style="padding:16px 0 16px 16px;width:56px;">${avatar}</td>
                  <td valign="middle" style="padding:16px;font-family:${FONT};${WRAP}">
                    <p style="margin:0;font-size:15px;line-height:20px;font-weight:600;color:${C.ink};">${escapeHtml(displayName)}</p>
                    <p style="margin:2px 0 8px;font-size:13px;line-height:18px;color:${C.muted};">${escapeHtml(kerberos)}@iitd.ac.in &middot; ${changeCount} ${changeCount === 1 ? 'change' : 'changes'} in ${sections.length} ${sections.length === 1 ? 'section' : 'sections'}</p>
                    <span style="display:inline-block;background:#ffffff;border:1px solid ${C.line};border-radius:999px;padding:3px 10px;font-size:12px;line-height:16px;font-weight:600;color:${C.body};">&#9679;&nbsp; ${escapeHtml(actorBadge(actors))}</span>
                  </td>
                </tr>
              </table>
            </td></tr>

            <tr><td class="px" style="padding:6px 40px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${sections.map((s, i) => sectionHtml(s, i === sections.length - 1)).join('')}
              </table>
            </td></tr>

            <tr><td class="px" align="left" style="padding:8px 40px 30px;">
              <table role="presentation" class="btn-table" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" bgcolor="${C.primary}" style="border-radius:10px;background:${C.primary};">
                  <a class="btn-link" href="${escapeHtml(profileUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">View your profile &rarr;</a>
                </td>
              </tr></table>
            </td></tr>

            <tr><td class="px" style="padding:0 40px 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;">
                <tr><td style="padding:16px 18px;font-family:${FONT};">
                  <p style="margin:0 0 4px;font-size:14px;line-height:20px;font-weight:700;color:#9a3412;">${escapeHtml(REPLY_TITLE)}</p>
                  <p style="margin:0;font-size:14px;line-height:22px;color:#9a3412;">${escapeHtml(REPLY_BODY)}</p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:24px 24px 0;font-family:${FONT};">
          <p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${C.muted};">
            <a href="${escapeHtml(profileUrl.replace(/\/faculty\/.*$/, '') || profileUrl)}" style="color:${C.muted};text-decoration:underline;">Research Ambit</a> &middot; Indian Institute of Technology Delhi, Hauz Khas, New Delhi 110016
          </p>
          <p style="margin:0;font-size:12px;line-height:18px;color:${C.faint};">This is an automated notice, sent whenever your faculty profile on Research Ambit changes.</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;

    return { subject, text, html, attachments: [sealAttachment()] };
};
