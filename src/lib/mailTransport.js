import nodemailer from 'nodemailer';

const DEV_RECIPIENT = 'ch7221511@iitd.ac.in';

let transporter = null;

export const isMailConfigured = () =>
    Boolean(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS);

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

export const fromHeader = () =>
    `"${process.env.MAIL_FROM_NAME || 'Research Ambit, IIT Delhi'}" <${senderAddress()}>`;

export const getTransporter = () => {
    if (transporter) return transporter;
    const port = Number(process.env.MAIL_PORT) || 587;
    transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port,
        secure: process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : port === 465,
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
