import nodemailer from 'nodemailer';

const DEV_RECIPIENT = 'ch7221511@iitd.ac.in';
const SUPPORT_ADDRESS = 'support.rambit@iitd.ac.in';
const IITD_SMTP = { host: 'smtp.iitd.ac.in', port: 465, secure: true };

let transporter = null;
let warnedOverride = false;

export const isMailConfigured = () => Boolean(process.env.MAIL_USER && process.env.MAIL_PASS);

/** IITD SMTP is the only server in production. MAIL_HOST/MAIL_PORT may point
 * elsewhere only outside production (e.g. a local test server). */
export const smtpServer = () => {
    const host = process.env.MAIL_HOST;
    if (!host || host === IITD_SMTP.host) return IITD_SMTP;
    if (process.env.NODE_ENV === 'production') {
        if (!warnedOverride) {
            console.warn(`[Mailer] ignoring MAIL_HOST=${host} in production; using ${IITD_SMTP.host}:${IITD_SMTP.port}`);
            warnedOverride = true;
        }
        return IITD_SMTP;
    }
    const port = Number(process.env.MAIL_PORT) || 587;
    return { host, port, secure: process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : port === 465 };
};

// Only the exact string "true" sends mail to real faculty addresses.
export const isMailProd = () => process.env.MAIL_PROD === 'true';

export const devRecipient = () => process.env.MAIL_DEV_TO || DEV_RECIPIENT;

/** The sending mailbox. IITD SMTP logs in with a bare kerberos id, so a
 * MAIL_USER without "@" is expanded to its iitd.ac.in address. */
export const senderAddress = () => {
    if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
    const user = process.env.MAIL_USER || '';
    return user.includes('@') ? user : `${user}@iitd.ac.in`;
};

/** Where faculty replies to automated notices go. */
export const replyToAddress = () => process.env.MAIL_REPLY_TO || SUPPORT_ADDRESS;

export const fromHeader = () =>
    `"${process.env.MAIL_FROM_NAME || 'Research Ambit, IIT Delhi'}" <${senderAddress()}>`;

export const getTransporter = () => {
    if (transporter) return transporter;
    transporter = nodemailer.createTransport({
        ...smtpServer(),
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
        pool: true,
        maxConnections: 1,
        maxMessages: 50,
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 60_000,
    });
    return transporter;
};

export const closeTransporter = () => {
    transporter?.close();
    transporter = null;
};
