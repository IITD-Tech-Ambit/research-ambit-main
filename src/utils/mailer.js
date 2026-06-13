import nodemailer from 'nodemailer';

const createTransporter = () =>
    nodemailer.createTransport({
        host: process.env.MAIL_HOST || 'smtp.gmail.com',
        port: Number(process.env.MAIL_PORT) || 587,
        secure: false, // true for port 465, false for 587 (STARTTLS)
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
        },
        pool: false,
    });

/**
 * Send a suggestion notification email to the Research Ambit team.
 * Returns silently if email credentials are not configured.
 * @param {{ name: string, email: string, category: string, message: string, createdAt: Date }} suggestion
 */
const sendSuggestionEmail = async (suggestion) => {
    // Skip silently if credentials are not configured
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
        console.warn('[Mailer] MAIL_USER or MAIL_PASS not set — skipping email notification.');
        return;
    }

    const transporter = createTransporter();

    const replyTo = suggestion.email || undefined;
    const submittedBy = suggestion.name || 'Anonymous';
    const formattedDate = new Date(suggestion.createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'long',
        timeStyle: 'short',
    });

    const textBody = [
        `New Suggestion – Research Ambit`,
        `─────────────────────────────`,
        `Category : ${suggestion.category}`,
        `From     : ${submittedBy}${suggestion.email ? ` <${suggestion.email}>` : ''}`,
        `Date     : ${formattedDate} IST`,
        ``,
        `Message:`,
        suggestion.message,
        ...(suggestion.screenshotUrl ? [``, `Screenshot: ${suggestion.screenshotUrl}`] : []),
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>New Suggestion – Research Ambit</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(34,68,150,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e40af 0%,#0ea5e9 100%);padding:32px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
              &#128236; New Suggestion Received
            </h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.80);font-size:13px;">
              Research Ambit &middot; IIT Delhi
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">

            <!-- Category badge -->
            <p style="margin:0 0 24px;">
              <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">
                ${escapeHtml(suggestion.category)}
              </span>
            </p>

            <!-- Message -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-left:4px solid #3b82f6;border-radius:4px;margin-bottom:28px;">
              <tr><td style="padding:18px 20px;">
                <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:600;">Message</p>
                <p style="margin:0;font-size:15px;color:#1e293b;line-height:1.7;white-space:pre-wrap;">${escapeHtml(suggestion.message)}</p>
              </td></tr>
            </table>

            <!-- Details grid -->
            <table width="100%" cellpadding="0" cellspacing="0">
              ${suggestion.name ? `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;width:30%;">
                  <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">From</p>
                </td>
                <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                  <p style="margin:0;font-size:14px;color:#1e293b;">${escapeHtml(suggestion.name)}</p>
                </td>
              </tr>` : ''}
              ${suggestion.email ? `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;width:30%;">
                  <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Email</p>
                </td>
                <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                  <p style="margin:0;font-size:14px;color:#1e293b;">
                    <a href="mailto:${escapeHtml(suggestion.email)}" style="color:#3b82f6;">${escapeHtml(suggestion.email)}</a>
                  </p>
                </td>
              </tr>` : ''}
              <tr>
                <td style="padding:8px 0;">
                  <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Submitted</p>
                </td>
                <td style="padding:8px 0;">
                  <p style="margin:0;font-size:14px;color:#1e293b;">${formattedDate} IST</p>
                </td>
              </tr>
            </table>

            ${suggestion.screenshotUrl ? `
            <!-- Screenshot -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
              <tr><td>
                <p style="margin:0 0 10px;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Attached Screenshot</p>
                <a href="${escapeHtml(suggestion.screenshotUrl)}" target="_blank" style="display:block;">
                  <img src="${escapeHtml(suggestion.screenshotUrl)}"
                       alt="Screenshot"
                       style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.08);" />
                </a>
                <p style="margin:6px 0 0;font-size:11px;color:#94a3b8;">
                  <a href="${escapeHtml(suggestion.screenshotUrl)}" style="color:#3b82f6;">Open full image &#8599;</a>
                </p>
              </td></tr>
            </table>` : ''}

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
              This email was sent automatically by Research Ambit &middot; IIT Delhi
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
        await transporter.sendMail({
            from: `"Research Ambit" <${process.env.MAIL_USER}>`,
            to: process.env.MAIL_TO || 'researchambit@iitd.ac.in',
            replyTo,
            subject: `New Research Ambit Suggestion - ${suggestion.category}`,
            text: textBody,
            html,
        });
    } finally {
        transporter.close();
    }
};

const escapeHtml = (str = '') =>
    String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

export { sendSuggestionEmail };
