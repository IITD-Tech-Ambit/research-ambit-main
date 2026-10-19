/**
 * Check the SMTP setup and preview the profile-update email.
 *
 *   npm run mail:test -- --verify            log in to SMTP only, send nothing
 *   npm run mail:test -- --preview out.html  render a sample email to a file
 *   npm run mail:test                        send a sample email
 *
 * The sample is always sent to MAIL_DEV_TO (default ch7221511@iitd.ac.in),
 * never to a faculty member, regardless of MAIL_PROD.
 */
import fs from 'fs';
import dotenv from 'dotenv';
import {
    closeTransporter, devRecipient, fromHeader, getTransporter, isMailConfigured, senderAddress,
} from '../lib/mailTransport.js';
import { buildProfileUpdateEmail, describeProfileChanges } from '../services/profileUpdateEmail.js';

dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const previewPath = args.includes('--preview') ? args[args.indexOf('--preview') + 1] || 'profile-update-preview.html' : null;

const before = {
    title: 'Prof.', firstName: 'Sample', lastName: 'Faculty',
    metric_visibility: { h_index: true, citations: true },
    background: 'Works on catalysis.',
    background_visible: false,
    qualifications: ['B.Tech, IIT Delhi'],
    phone: '',
    external_links: [{ label: 'Lab', url: 'https://example.org/lab' }],
};
const after = {
    ...before,
    profile_image_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    metric_visibility: { h_index: false, citations: true },
    background: 'Works on heterogeneous catalysis and reaction engineering, with a focus on sustainable fuels and green chemical processes for industry.',
    background_visible: true,
    qualifications: ['B.Tech, IIT Delhi', 'Ph.D., MIT'],
    qualifications_visible: true,
    phone: '+91 11 2659 0000',
    phone_visible: true,
    external_links: [{ label: 'Research group', url: 'https://example.org/lab' }],
};

const now = Date.now();
const email = buildProfileUpdateEmail({
    name: 'Prof. Sample Faculty',
    kerberos: 'samplefac',
    sections: describeProfileChanges(before, after),
    actors: [{ kind: 'self' }],
    firstChangeAt: new Date(now - 7 * 60_000),
    lastChangeAt: new Date(now),
    profileUrl: 'https://researchambit.iitd.ac.in/faculty/samplefac',
    devRedirectedFrom: 'samplefac@iitd.ac.in',
});

if (previewPath) {
    fs.writeFileSync(previewPath, email.html);
    console.log(email.text);
    console.log(`\nHTML preview written to ${previewPath}`);
    process.exit(0);
}

if (!isMailConfigured()) {
    console.error('Set MAIL_HOST, MAIL_USER and MAIL_PASS (and MAIL_PORT if not 587) first.');
    process.exit(1);
}

try {
    const transporter = getTransporter();
    await transporter.verify();
    console.log(`SMTP login OK as ${process.env.MAIL_USER} on ${process.env.MAIL_HOST}:${process.env.MAIL_PORT || 587}`);
    if (!args.includes('--verify')) {
        const info = await transporter.sendMail({
            from: fromHeader(),
            to: devRecipient(),
            replyTo: senderAddress(),
            subject: `[TEST] ${email.subject}`,
            text: email.text,
            html: email.html,
        });
        console.log(`Sample sent to ${devRecipient()} (message id ${info.messageId})`);
    }
} catch (err) {
    console.error(`SMTP error: ${err.message}`);
    process.exitCode = 1;
} finally {
    closeTransporter();
}
