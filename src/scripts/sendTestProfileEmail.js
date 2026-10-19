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
    closeTransporter, devRecipient, fromHeader, getTransporter, isMailConfigured, replyToAddress, smtpServer,
} from '../lib/mailTransport.js';
import { buildProfileUpdateEmail, describeProfileChanges, sealAttachment } from '../services/profileUpdateEmail.js';

dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const previewPath = args.includes('--preview') ? args[args.indexOf('--preview') + 1] || 'profile-update-preview.html' : null;

const before = {
    title: 'Prof.', firstName: 'Sample', lastName: 'Faculty',
    profile_image_url: 'https://res.cloudinary.com/demo/image/upload/lady.jpg',
    metric_visibility: { h_index: true, citations: true },
    background: 'Works on catalysis.',
    background_visible: false,
    qualifications: ['B.Tech, IIT Delhi'],
    phone: '',
    external_links: [{ label: 'Lab', url: 'https://example.org/lab' }],
};
const after = {
    ...before,
    profile_image_url: 'https://res.cloudinary.com/demo/image/upload/woman.jpg',
    metric_visibility: { h_index: false, citations: true },
    background: 'Works on heterogeneous catalysis and reaction engineering, with a focus on sustainable fuels and green chemical processes for industry.',
    background_visible: true,
    qualifications: ['B.Tech, IIT Delhi', 'Ph.D., MIT'],
    qualifications_visible: true,
    phone: '+91 11 2659 0000',
    phone_visible: true,
    additional_emails: ['sample.faculty.secondary.address@chemical.iitd.ac.in'],
    external_links: [
        { label: 'Research group', url: 'https://example.org/lab' },
        { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=AbCdEfGhIjKlMnOp&hl=en&oi=ao' },
    ],
};

const now = Date.now();
const render = (sealSrc) => buildProfileUpdateEmail({
    name: 'Prof. Sample Faculty',
    kerberos: 'samplefac',
    sections: describeProfileChanges(before, after),
    actors: [{ kind: 'self' }],
    firstChangeAt: new Date(now - 7 * 60_000),
    lastChangeAt: new Date(now),
    profileUrl: 'https://researchambit.iitd.ac.in/faculty/samplefac',
    photoUrl: after.profile_image_url,
    devRedirectedFrom: 'samplefac@iitd.ac.in',
    ...(sealSrc ? { sealSrc } : {}),
});
const email = render();

if (previewPath) {
    const seal = fs.readFileSync(sealAttachment().path).toString('base64');
    fs.writeFileSync(previewPath, render(`data:image/png;base64,${seal}`).html);
    console.log(email.text);
    console.log(`\nHTML preview written to ${previewPath}`);
    process.exit(0);
}

if (!isMailConfigured()) {
    console.error('Set MAIL_USER and MAIL_PASS first.');
    process.exit(1);
}

try {
    const transporter = getTransporter();
    await transporter.verify();
    const { host, port } = smtpServer();
    console.log(`SMTP login OK as ${process.env.MAIL_USER} on ${host}:${port}`);
    if (!args.includes('--verify')) {
        const info = await transporter.sendMail({
            from: fromHeader(),
            to: devRecipient(),
            replyTo: replyToAddress(),
            subject: `[TEST] ${email.subject}`,
            text: email.text,
            html: email.html,
            attachments: email.attachments,
        });
        console.log(`Sample sent to ${devRecipient()} (message id ${info.messageId})`);
    }
} catch (err) {
    console.error(`SMTP error: ${err.message}`);
    process.exitCode = 1;
} finally {
    closeTransporter();
}
