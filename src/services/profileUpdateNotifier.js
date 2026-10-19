/**
 * Queues and sends "your profile was updated" emails.
 *
 * Every successful profile write records a before/after snapshot into one
 * pending notice per faculty member. The notice is sent once the profile has
 * been quiet for PROFILE_MAIL_QUIET_MINUTES (but no later than
 * PROFILE_MAIL_MAX_WAIT_MINUTES after the first edit), so one editing session
 * produces one email. Notices live in MongoDB, so restarts lose nothing, and
 * are claimed atomically, so several backend instances never double-send.
 */
import ProfileUpdateNotice from '../models/profileUpdateNotice.js';
import {
    devRecipient, fromHeader, getTransporter, isMailConfigured, isMailProd, replyToAddress,
} from '../lib/mailTransport.js';
import {
    buildProfileUpdateEmail, describeProfileChanges, facultyDisplayName, snapshotProfile, snapshotsEqual,
} from './profileUpdateEmail.js';

const minutes = (name, fallback) => {
    const n = Number(process.env[name]);
    return (Number.isFinite(n) && n >= 0 ? n : fallback) * 60_000;
};

const QUIET_MS = minutes('PROFILE_MAIL_QUIET_MINUTES', 10);
const MAX_WAIT_MS = minutes('PROFILE_MAIL_MAX_WAIT_MINUTES', 30);
const POLL_MS = 60_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const BATCH_PER_TICK = 20;
const RETENTION_MS = 365 * 24 * 60 * 60_000;
const KERBEROS_RE = /^[a-z0-9][a-z0-9._-]*$/;

const siteUrl = () => (process.env.SITE_URL || 'https://researchambit.iitd.ac.in').replace(/\/+$/, '');

export const profileUpdateEmailsEnabled = () =>
    isMailConfigured() && process.env.PROFILE_UPDATE_EMAILS !== 'false';

const IITD_EMAIL_RE = /^[^\s@]+@([a-z0-9-]+\.)*iitd\.ac\.in$/i;

/** The faculty member's directory email (department addresses included), or
 * <kerberos>@iitd.ac.in when it is missing or outside IIT Delhi. */
export const facultyAddress = (kerberos, directoryEmail) => {
    const email = String(directoryEmail || '').trim().toLowerCase();
    return IITD_EMAIL_RE.test(email) ? email : `${kerberos}@iitd.ac.in`;
};

/** Where a notice goes: the faculty member only when MAIL_PROD=true. */
export const resolveRecipient = (kerberos, directoryEmail) => {
    const address = facultyAddress(kerberos, directoryEmail);
    return isMailProd() ? { to: address } : { to: devRecipient(), redirectedFrom: address };
};

export class UndeliverableRecipientError extends Error {}

/** Last line of defence before an SMTP send. MAIL_PROD must be exactly "true"
 * to reach anyone but the dev inbox, and that address must belong to IIT Delhi. */
export const guardRecipient = (to) => {
    const dest = String(to || '').trim().toLowerCase();
    if (!isMailProd()) {
        const dev = devRecipient().trim().toLowerCase();
        if (dest !== dev) {
            throw new UndeliverableRecipientError(`Refusing to email ${dest || '(nobody)'} while MAIL_PROD is not true`);
        }
        return dest;
    }
    if (!IITD_EMAIL_RE.test(dest)) {
        throw new UndeliverableRecipientError(`Refusing to email ${dest || '(nobody)'}: not an IIT Delhi address`);
    }
    return dest;
};

/** Who made the edit: the faculty themself, or a superadmin acting for them. */
export const actorFromRequest = (req, kerberos) => {
    const authKerberos = String(req.headers['x-user-kerberos'] || '').toLowerCase();
    if (req.headers['x-user-role'] === 'superadmin' && authKerberos !== kerberos) {
        return { kind: 'superadmin', id: authKerberos || String(req.headers['x-user-id'] || '') };
    }
    return { kind: 'self', id: kerberos };
};

/**
 * Record one successful profile write. Never throws: a notification problem
 * must not fail an edit that has already been saved.
 */
export const recordProfileChange = async ({ kerberos, before, after, actor }) => {
    if (!profileUpdateEmailsEnabled() || !before || !after) return;
    const baseline = snapshotProfile(before);
    const latest = snapshotProfile(after);
    // A save that changed nothing must not open a new notice. It still has to
    // update one that is already waiting: a concurrent save may have queued a
    // diff that this write just undid, and the email must match the stored profile.
    const unchanged = snapshotsEqual(baseline, latest);

    const now = new Date();
    // Pipeline update so baseline/firstChangeAt are kept from the first edit of
    // the session while sendAfter slides forward. $literal stops user text that
    // starts with "$" from being read as a field path.
    const pipeline = [
        {
            $set: {
                kerberos: { $literal: kerberos },
                status: { $literal: 'pending' },
                name: { $literal: facultyDisplayName(after) },
                email: { $literal: String(after.email || '') },
                baseline: { $ifNull: ['$baseline', { $literal: baseline }] },
                latest: { $literal: latest },
                actors: { $setUnion: [{ $ifNull: ['$actors', []] }, [{ $literal: actor }]] },
                firstChangeAt: { $ifNull: ['$firstChangeAt', now] },
                lastChangeAt: now,
                attempts: { $ifNull: ['$attempts', 0] },
                createdAt: { $ifNull: ['$createdAt', now] },
                updatedAt: now,
            },
        },
        { $set: { sendAfter: { $min: [new Date(now.getTime() + QUIET_MS), { $add: ['$firstChangeAt', MAX_WAIT_MS] }] } } },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await ProfileUpdateNotice.collection.updateOne(
                { kerberos, status: 'pending' },
                pipeline,
                { upsert: !unchanged },
            );
            return;
        } catch (err) {
            // Two concurrent first edits can race on the upsert; the retry matches the winner.
            if (err?.code === 11000 && attempt === 0) continue;
            console.error(`[ProfileMail] failed to queue notice for ${kerberos}:`, err?.message || err);
            return;
        }
    }
};

const claimNext = (now) =>
    ProfileUpdateNotice.findOneAndUpdate(
        {
            $or: [
                { status: { $in: ['pending', 'retry'] }, sendAfter: { $lte: now } },
                { status: 'sending', leaseUntil: { $lt: now } },
            ],
        },
        { $set: { status: 'sending', leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
        { sort: { sendAfter: 1 }, new: true },
    ).lean();

const finish = (id, fields) =>
    ProfileUpdateNotice.updateOne(
        { _id: id },
        { $set: { ...fields, expireAt: new Date(Date.now() + RETENTION_MS) }, $unset: { leaseUntil: 1 } },
    );

export const deliverNotice = async (notice) => {
    const sections = describeProfileChanges(notice.baseline, notice.latest);
    if (sections.length === 0) {
        await finish(notice._id, { status: 'skipped' });
        return 'skipped';
    }
    if (!KERBEROS_RE.test(notice.kerberos)) {
        await finish(notice._id, { status: 'failed', lastError: `Invalid kerberos "${notice.kerberos}"` });
        return 'failed';
    }

    let { to, redirectedFrom } = resolveRecipient(notice.kerberos, notice.email);
    try {
        to = guardRecipient(to);
    } catch (err) {
        await finish(notice._id, { status: 'failed', lastError: String(err.message).slice(0, 500) });
        console.error(`[ProfileMail] ${err.message} (kerberos ${notice.kerberos})`);
        return 'failed';
    }
    const email = buildProfileUpdateEmail({
        name: notice.name,
        kerberos: notice.kerberos,
        facultyEmail: facultyAddress(notice.kerberos, notice.email),
        sections,
        actors: notice.actors,
        firstChangeAt: notice.firstChangeAt,
        lastChangeAt: notice.lastChangeAt,
        profileUrl: `${siteUrl()}/faculty/${encodeURIComponent(notice.kerberos)}`,
        photoUrl: notice.latest?.profile_image_url,
        devRedirectedFrom: redirectedFrom,
    });

    try {
        const info = await getTransporter().sendMail({
            from: fromHeader(),
            to,
            replyTo: replyToAddress(),
            subject: email.subject,
            text: email.text,
            html: email.html,
            attachments: email.attachments,
            headers: { 'Auto-Submitted': 'auto-generated' },
        });
        if (info?.rejected?.length) throw new Error(`SMTP rejected ${info.rejected.join(', ')}`);
        await finish(notice._id, { status: 'sent', sentAt: new Date(), recipient: to, messageId: info?.messageId, lastError: null });
        console.info(JSON.stringify({ event: 'profile_update_email_sent', kerberos: notice.kerberos, to, sections: sections.length }));
        return 'sent';
    } catch (err) {
        const lastError = String(err?.message || err).slice(0, 500);
        if (notice.attempts >= MAX_ATTEMPTS) {
            await finish(notice._id, { status: 'failed', lastError, recipient: to });
            console.error(`[ProfileMail] giving up on ${notice.kerberos} after ${notice.attempts} attempts: ${lastError}`);
            return 'failed';
        }
        const backoffMs = Math.min(2 ** notice.attempts * 60_000, 60 * 60_000);
        await ProfileUpdateNotice.updateOne(
            { _id: notice._id },
            { $set: { status: 'retry', sendAfter: new Date(Date.now() + backoffMs), lastError }, $unset: { leaseUntil: 1 } },
        );
        console.warn(`[ProfileMail] send to ${to} failed (attempt ${notice.attempts}), retrying in ${backoffMs / 60_000} min: ${lastError}`);
        return 'retry';
    }
};

let ticking = false;
let stopRequested = false;

export const runProfileMailTick = async () => {
    if (ticking || stopRequested) return;
    ticking = true;
    try {
        for (let i = 0; i < BATCH_PER_TICK; i++) {
            const notice = await claimNext(new Date());
            if (!notice) break;
            await deliverNotice(notice);
        }
    } catch (err) {
        console.error('[ProfileMail] worker tick failed:', err?.message || err);
    } finally {
        ticking = false;
    }
};

/** Start the background sender. Returns a stop function. */
export const startProfileUpdateWorker = () => {
    if (!profileUpdateEmailsEnabled()) {
        console.info('[ProfileMail] disabled (SMTP not configured or PROFILE_UPDATE_EMAILS=false)');
        return () => {};
    }
    console.info(isMailProd()
        ? '[ProfileMail] enabled: MAIL_PROD=true, sending to faculty directory addresses'
        : `[ProfileMail] enabled in dev mode: all notices go to ${devRecipient()}`);
    const interval = setInterval(runProfileMailTick, POLL_MS);
    interval.unref();
    const first = setTimeout(runProfileMailTick, 10_000);
    first.unref();
    // Wait for a send that is already in flight so a restart can't leave it
    // claimed but unfinished (the lease would otherwise resend it).
    return async () => {
        stopRequested = true;
        clearInterval(interval);
        clearTimeout(first);
        const deadline = Date.now() + 20_000;
        while (ticking && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    };
};
