/**
 * Pure helpers for the "your profile was updated" email: snapshot the
 * faculty-editable fields, describe what changed between two snapshots, and
 * render the email. No I/O, so it is unit-tested directly.
 */

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

const visibilityLine = (nowVisible) =>
    nowVisible ? 'Section is now shown on your public profile.' : 'Section is now hidden from your public profile.';

/**
 * Human-readable changes between two snapshots, grouped by profile section:
 * [{ title, items: string[], imageUrl?, quote? }]. Empty when nothing net changed.
 */
export const describeProfileChanges = (baseline = {}, latest = {}) => {
    const b = snapshotProfile(baseline);
    const a = snapshotProfile(latest);
    const sections = [];

    if (b.profile_image_url !== a.profile_image_url) {
        sections.push(
            a.profile_image_url
                ? { title: 'Profile photo', items: ['Your profile photo was replaced.'], imageUrl: a.profile_image_url }
                : { title: 'Profile photo', items: ['Your profile photo was removed.'] },
        );
    }

    const metricItems = METRICS
        .filter(([k]) => b.metric_visibility[k] !== a.metric_visibility[k])
        .map(([k, label]) => `${label}: now ${a.metric_visibility[k] ? 'shown on' : 'hidden from'} your public profile.`);
    if (metricItems.length) sections.push({ title: 'Research metrics', items: metricItems });

    for (const s of SECTIONS) {
        const items = [];
        let quote;
        const before = b[s.key];
        const after = a[s.key];

        if (s.visibleKey && b[s.visibleKey] !== a[s.visibleKey]) items.push(visibilityLine(a[s.visibleKey]));

        if (s.type === 'text' && before !== after) {
            if (!after.trim()) items.push('Text was removed.');
            else {
                items.push(before.trim() ? 'Text was updated. It now begins:' : 'Text was added. It begins:');
                quote = excerpt(after);
            }
        } else if (s.type === 'list') {
            const { added, removed } = listDiff(before, after);
            added.forEach((x) => items.push(`Added: ${x}`));
            removed.forEach((x) => items.push(`Removed: ${x}`));
        } else if (s.type === 'value' && before !== after) {
            if (!before) items.push(`Added: ${after}`);
            else if (!after) items.push(`Removed (was: ${before})`);
            else items.push(`Changed from "${before}" to "${after}"`);
        } else if (s.type === 'links') {
            const byUrl = (xs) => new Map(xs.map((l) => [l.url.toLowerCase(), l]));
            const bm = byUrl(before);
            const am = byUrl(after);
            for (const [key, l] of am) {
                const old = bm.get(key);
                if (!old) items.push(`Added: ${l.label} (${l.url})`);
                else if (old.label !== l.label) items.push(`Renamed: "${old.label}" to "${l.label}" (${l.url})`);
            }
            for (const [key, l] of bm) if (!am.has(key)) items.push(`Removed: ${l.label} (${l.url})`);
        }

        if (items.length) sections.push({ title: s.title, items, ...(quote ? { quote } : {}) });
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

const escapeHtml = (str = '') =>
    String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const SUBJECT = 'Your Research Ambit profile was updated';
const REPLY_LINE = "Didn't make these changes, or does something look wrong? Just reply to this email and the Research Ambit team will look into it.";

/**
 * @param {{ name: string, kerberos: string, sections: ReturnType<typeof describeProfileChanges>,
 *   actors: {kind: string}[], firstChangeAt: Date, lastChangeAt: Date, profileUrl: string,
 *   devRedirectedFrom?: string }} input  devRedirectedFrom = the real recipient, when the
 *   mail is being redirected to the dev inbox instead.
 */
export const buildProfileUpdateEmail = ({
    name, kerberos, sections, actors, firstChangeAt, lastChangeAt, profileUrl, devRedirectedFrom,
}) => {
    const greeting = `Dear ${name || kerberos},`;
    const intro = `The following changes were made to your faculty profile on Research Ambit ${describeWhen(firstChangeAt, lastChangeAt)}. ${describeActors(actors, kerberos)}`;
    const subject = devRedirectedFrom ? `[DEV → ${devRedirectedFrom}] ${SUBJECT}` : SUBJECT;

    const text = [
        ...(devRedirectedFrom ? [`[DEV] In production this email would be sent to ${devRedirectedFrom}.`, ''] : []),
        greeting,
        '',
        intro,
        '',
        ...sections.flatMap((s) => [
            s.title.toUpperCase(),
            ...s.items.map((i) => `  - ${i}`),
            ...(s.quote ? [`    "${s.quote}"`] : []),
            ...(s.imageUrl ? [`    New photo: ${s.imageUrl}`] : []),
            '',
        ]),
        `View your profile: ${profileUrl}`,
        '',
        REPLY_LINE,
        '',
        'Research Ambit · IIT Delhi',
        'You are receiving this automated notice because your faculty profile on Research Ambit changed.',
    ].join('\n');

    const sectionHtml = sections.map((s) => `
            <tr><td style="padding:0 0 20px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#1e40af;">${escapeHtml(s.title)}</p>
              ${s.imageUrl && /^https:\/\//i.test(s.imageUrl) ? `<img src="${escapeHtml(s.imageUrl)}" alt="New profile photo" width="96" height="96" style="display:block;width:96px;height:96px;border-radius:16px;object-fit:cover;margin:0 0 10px;border:1px solid #e2e8f0;" />` : ''}
              ${s.items.map((i) => `<p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1e293b;">&bull;&nbsp; ${escapeHtml(i)}</p>`).join('')}
              ${s.quote ? `<p style="margin:8px 0 0;padding:10px 14px;background:#f8fafc;border-left:3px solid #93c5fd;border-radius:4px;font-size:13px;line-height:1.6;color:#475569;font-style:italic;">${escapeHtml(s.quote)}</p>` : ''}
            </td></tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px;">
    <tr><td align="center">
      ${devRedirectedFrom ? `<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 0 12px;"><tr><td style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 16px;font-size:13px;color:#92400e;">
        <strong>DEV preview.</strong> In production this email would be sent to <strong>${escapeHtml(devRedirectedFrom)}</strong>.
      </td></tr></table>` : ''}
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(34,68,150,0.10);">
        <tr>
          <td style="background:#1e40af;background:linear-gradient(135deg,#1e40af 0%,#0ea5e9 100%);padding:28px 36px;">
            <h1 style="margin:0;color:#ffffff;font-size:21px;font-weight:700;">Your profile was updated</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Research Ambit &middot; IIT Delhi</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px 8px;">
            <p style="margin:0 0 12px;font-size:15px;color:#1e293b;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#334155;">${escapeHtml(intro)}</p>
            <table width="100%" cellpadding="0" cellspacing="0">${sectionHtml}
            </table>
            <p style="margin:4px 0 28px;">
              <a href="${escapeHtml(profileUrl)}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">View your profile</a>
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin:0 0 28px;">
              <tr><td style="padding:14px 18px;font-size:14px;line-height:1.6;color:#9a3412;">${escapeHtml(REPLY_LINE)}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:18px 36px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;text-align:center;">
              You are receiving this automated notice because your faculty profile on Research Ambit changed.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    return { subject, text, html };
};
