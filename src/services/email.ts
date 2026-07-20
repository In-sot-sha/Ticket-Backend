import nodemailer from 'nodemailer';
import { Request, Response } from 'express';

// ── Email templates ──────────────────────────────────────────────────────────

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Initialize transporter (Gmail SMTP or custom SMTP)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify transporter connection on startup (non-blocking)
transporter.verify((error, success) => {
  if (error) {
    console.warn('[Email] SMTP configuration issue:', error.message);
    console.warn('[Email] Email service may not work. Check EMAIL_USER and EMAIL_PASS in .env');
  } else {
    console.log('[Email] ✅ SMTP connected and ready');
  }
});

// ── Email sending helper ─────────────────────────────────────────────────────

/**
 * Send email using nodemailer
 * @param options - Email options (to, subject, html)
 * @returns Promise with email send result
 */
export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('[Email] Email credentials not configured. Email not sent to:', options.to);
      return false;
    }

    const result = await transporter.sendMail({
      from: `"PartyStorm" <${process.env.EMAIL_USER}>`,
      ...options,
    });

    console.log('[Email] ✅ Email sent:', {
      to: options.to,
      subject: options.subject,
      messageId: result.messageId,
    });
    return true;
  } catch (error: any) {
    console.error('[Email] ❌ Failed to send email:', {
      to: options.to,
      subject: options.subject,
      error: error.message,
    });
    return false;
  }
};

// ── Email Templates ─────────────────────────────────────────────────────────

/**
 * OTP verification email template
 */
export const generateOTPEmail = (userEmail: string, otp: string, expiresIn: number = 10) => {
  const expiryTime = new Date(Date.now() + expiresIn * 60 * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    subject: `Your PartyStorm OTP: ${otp}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); padding: 30px; border-radius: 12px; text-align: center; color: white; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">PartyStorm</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Secure Your Account</p>
        </div>

        <div style="background: #f9fafb; padding: 25px; border-radius: 12px; border: 1px solid #e5e7eb;">
          <p style="margin: 0 0 20px 0; color: #374151; font-size: 14px;">
            Hi there! Here's your one-time password to verify your account:
          </p>

          <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; border: 2px dashed #f43f5e; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: 700; color: #f43f5e; letter-spacing: 4px;">
              ${otp}
            </span>
          </div>

          <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 13px; background: #fef2f2; padding: 12px; border-radius: 6px; border-left: 3px solid #fca5a5;">
            ⏱️ <strong>Expires in ${expiresIn} minutes</strong> at ${expiryTime}
          </p>

          <p style="margin: 20px 0 0 0; color: #374151; font-size: 14px;">
            Do not share this code with anyone. PartyStorm staff will never ask for your OTP.
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">

          <p style="margin: 0; color: #6b7280; font-size: 12px;">
            If you didn't request this, please ignore this email or <a href="#" style="color: #f43f5e; text-decoration: none;">report suspicious activity</a>.
          </p>
        </div>

        <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
          © 2026 PartyStorm. All rights reserved.
        </p>
      </div>
    `,
    text: `Your PartyStorm OTP is: ${otp}. It expires in ${expiresIn} minutes. Do not share this code with anyone.`,
  };
};

/**
 * Ticket purchase confirmation email template
 */
export const generateTicketConfirmationEmail = (
  userEmail: string,
  ticketData: {
    ticketId: string;
    eventTitle: string;
    eventDate: string;
    eventLocation: string;
    ticketType: string;
    quantity: number;
    totalPrice: number;
    qrCode?: string;
    ticketStyle?: string | null;
    accentColor?: string | null;
  }
) => {
  const ACCENTS: Record<string, string> = {
    rose: '#f43f5e',
    gold: '#eeb111',
    emerald: '#10b981',
    purple: '#8b5cf6',
    midnight: '#1e293b',
    ocean: '#0ea5e9',
  };

  const raw = (ticketData.ticketStyle || 'classic-rose').toLowerCase();
  type TicketEmailLayout = 'classic' | 'boarding' | 'stub';
  let layout: TicketEmailLayout = 'classic';
  let accentKey = 'rose';
  const match = raw.match(/^(classic|boarding|stub)-([a-z]+)$/);
  if (match) {
    layout = match[1] as TicketEmailLayout;
    accentKey = match[2];
  } else if (ACCENTS[raw]) {
    accentKey = raw;
  }
  const accent = ticketData.accentColor || ACCENTS[accentKey] || ACCENTS.rose;

  const passCard =
    layout === 'boarding'
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #e7ddd0;background:#f7f1e8;margin:16px 0;">
        <tr>
          <td width="28" style="background:${accent};color:#fff;font-size:9px;letter-spacing:1px;text-align:center;vertical-align:middle;padding:8px 4px;">PASS</td>
          <td style="padding:16px 14px;color:#3f2a1d;">
            <p style="margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.6;">Boarding Pass</p>
            <p style="margin:6px 0 0;font-size:20px;font-weight:700;font-family:Georgia,serif;color:${accent};">${ticketData.eventTitle}</p>
            <p style="margin:10px 0 0;font-size:12px;"><strong>${ticketData.ticketType}</strong> · ${ticketData.eventDate}</p>
            <p style="margin:4px 0 0;font-size:12px;">${ticketData.eventLocation}</p>
            <p style="margin:10px 0 0;font-size:11px;font-family:monospace;opacity:0.7;">${ticketData.ticketId}</p>
          </td>
          <td width="96" style="background:${accent}18;padding:12px;text-align:center;border-left:1px dashed #c4b5a5;">
            <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:1px;color:${accent};">ENTRY</p>
            <p style="margin:0;font-size:10px;color:#3f2a1d;">ADMIT ONE</p>
          </td>
        </tr>
      </table>`
      : layout === 'stub'
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #333;background:#0a0a0a;margin:16px 0;color:#fff;">
        <tr>
          <td style="padding:18px 16px;">
            <p style="margin:0;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${accent};">LIVE SHOW</p>
            <p style="margin:8px 0 0;font-size:22px;font-weight:800;text-transform:uppercase;">${ticketData.eventTitle}</p>
            <p style="margin:10px 0 0;font-size:12px;opacity:0.85;">${ticketData.eventLocation}</p>
            <p style="margin:6px 0 0;font-size:12px;opacity:0.7;">${ticketData.eventDate} · ${ticketData.ticketType}</p>
          </td>
          <td width="110" style="background:${accent};color:#000;padding:14px;text-align:center;border-left:2px dashed rgba(255,255,255,0.35);">
            <p style="margin:0;font-size:9px;font-weight:800;letter-spacing:1px;background:#000;color:#fff;display:inline-block;padding:3px 8px;border-radius:999px;">${ticketData.ticketType}</p>
            <p style="margin:12px 0 0;font-size:10px;font-weight:700;">TEAR &amp; KEEP</p>
            <p style="margin:4px 0 0;font-size:11px;font-family:monospace;">${ticketData.ticketId}</p>
          </td>
        </tr>
      </table>`
      : `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;margin:16px 0;">
        <tr>
          <td style="padding:18px 16px;background:#111827;color:#fff;">
            <p style="margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.7;">COME AND JOIN</p>
            <p style="margin:8px 0 0;font-size:20px;font-weight:800;"><span style="color:${accent};">${ticketData.eventTitle.split(' ')[0]}</span> ${ticketData.eventTitle.split(' ').slice(1).join(' ')}</p>
            <p style="margin:12px 0 0;font-size:12px;opacity:0.8;">${ticketData.eventLocation}</p>
            <p style="margin:6px 0 0;font-size:12px;opacity:0.7;">${ticketData.eventDate}</p>
          </td>
          <td width="120" style="background:${accent};color:#000;padding:16px;text-align:center;">
            <p style="margin:0;font-size:9px;font-weight:800;letter-spacing:1px;background:#000;color:#fff;display:inline-block;padding:3px 8px;border-radius:999px;">${ticketData.ticketType}</p>
            <p style="margin:14px 0 0;font-size:10px;font-weight:700;">SCAN TO ENTRY</p>
            <p style="margin:4px 0 0;font-size:11px;font-family:monospace;">${ticketData.ticketId}</p>
          </td>
        </tr>
      </table>`;

  return {
    subject: `Your Tickets for ${ticketData.eventTitle}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: ${accent}; padding: 28px; border-radius: 12px; text-align: center; color: white; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">PartyStorm</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Ticket Confirmation</p>
        </div>

        <div style="background: #f9fafb; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb; margin-bottom: 20px;">
          <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px;">
            Great! Your tickets for <strong>${ticketData.eventTitle}</strong> have been confirmed.
          </p>

          ${passCard}

          <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid ${accent};">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <p style="margin: 0; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Quantity</p>
                <p style="margin: 4px 0 0 0; color: #1f2937; font-size: 15px; font-weight: 600;">${ticketData.quantity} ticket(s)</p>
              </div>
              <div>
                <p style="margin: 0; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Total</p>
                <p style="margin: 4px 0 0 0; color: ${accent}; font-size: 18px; font-weight: 700;">₦${ticketData.totalPrice.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div style="background: #dbeafe; padding: 14px; border-radius: 8px; margin-top: 14px; border-left: 4px solid #3b82f6;">
            <p style="margin: 0; color: #1e40af; font-size: 13px;">
              ✓ Your QR code has been emailed separately. Save it to your phone or print it.
            </p>
          </div>

          <p style="margin: 18px 0 0 0; color: #6b7280; font-size: 13px;">
            You can view, download, and manage your tickets anytime by logging into your PartyStorm account.
          </p>
        </div>

        <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">
          © 2026 PartyStorm. All rights reserved.
        </p>
      </div>
    `,
    text: `Your ticket for ${ticketData.eventTitle} has been confirmed. Ticket ID: ${ticketData.ticketId}. Check your email for your QR code.`,
  };
};

/**
 * Password reset email template
 */
export const generatePasswordResetEmail = (userEmail: string, resetLink: string, expiresIn: number = 1) => {
  return {
    subject: 'Reset Your PartyStorm Password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); padding: 30px; border-radius: 12px; text-align: center; color: white; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">PartyStorm</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Password Reset</p>
        </div>

        <div style="background: #f9fafb; padding: 25px; border-radius: 12px; border: 1px solid #e5e7eb;">
          <p style="margin: 0 0 20px 0; color: #374151; font-size: 14px;">
            We received a request to reset your password. Click the button below to create a new password.
          </p>

          <a href="${resetLink}" style="display: inline-block; width: 100%; padding: 14px 20px; background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; text-align: center; margin: 20px 0; transition: opacity 0.2s;">
            Reset Password
          </a>

          <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 13px; background: #fef2f2; padding: 12px; border-radius: 6px; border-left: 3px solid #fca5a5;">
            ⏱️ <strong>This link expires in ${expiresIn} hour(s)</strong>
          </p>

          <p style="margin: 20px 0 0 0; color: #374151; font-size: 14px;">
            If you didn't request this, you can ignore this email. Your password will remain unchanged.
          </p>

          <p style="margin: 15px 0 0 0; color: #374151; font-size: 12px;">
            Or copy and paste this link in your browser:<br>
            <span style="color: #6b7280; word-break: break-all; font-size: 11px;">${resetLink}</span>
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">

          <p style="margin: 0; color: #6b7280; font-size: 12px;">
            © 2026 PartyStorm. All rights reserved.
          </p>
        </div>
      </div>
    `,
    text: `Click here to reset your password: ${resetLink}. This link expires in ${expiresIn} hour(s).`,
  };
};

/**
 * Welcome/registration email template
 */
export const generateWelcomeEmail = (userName: string) => {
  return {
    subject: 'Welcome to PartyStorm! 🎉',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); padding: 30px; border-radius: 12px; text-align: center; color: white; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">PartyStorm</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Welcome to the Community!</p>
        </div>

        <div style="background: #f9fafb; padding: 25px; border-radius: 12px; border: 1px solid #e5e7eb;">
          <p style="margin: 0 0 20px 0; color: #374151; font-size: 14px;">
            Hi ${userName}! Welcome to PartyStorm 🎉
          </p>

          <p style="margin: 0 0 15px 0; color: #374151; font-size: 14px;">
            You've just joined a vibrant community of event enthusiasts. Here's what you can do now:
          </p>

          <ul style="margin: 15px 0 15px 20px; color: #374151; font-size: 14px; line-height: 1.8;">
            <li>🔍 Discover events happening near you</li>
            <li>❤️ Save your favorite events to your wishlist</li>
            <li>🎫 Book tickets with secure payment options</li>
            <li>📋 Manage your event registrations from your dashboard</li>
            <li>🎤 Host your own events and build your audience</li>
          </ul>

          <p style="margin: 20px 0 0 0; color: #374151; font-size: 14px;">
            If you have any questions or need help, feel free to reach out to our support team.
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">

          <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
            © 2026 PartyStorm. All rights reserved.
          </p>
        </div>
      </div>
    `,
    text: `Welcome to PartyStorm! Discover events, save favorites, and book tickets today.`,
  };
};

/**
 * Vendor application confirmation email template
 */
export const generateVendorApplicationEmail = (
  userEmail: string,
  applicationData: {
    eventTitle: string;
    businessName: string;
    stallType: string;
  }
) => {
  return {
    subject: `Vendor Application Received for ${applicationData.eventTitle}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); padding: 30px; border-radius: 12px; text-align: center; color: white; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">PartyStorm</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Vendor Application Received</p>
        </div>

        <div style="background: #f9fafb; padding: 25px; border-radius: 12px; border: 1px solid #e5e7eb; margin-bottom: 20px;">
          <p style="margin: 0 0 20px 0; color: #374151; font-size: 14px;">
            Hi there, we have received your vendor application for <strong>${applicationData.eventTitle}</strong>.
          </p>

          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #f43f5e;">
            <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Business Name</p>
            <p style="margin: 5px 0 15px 0; color: #1f2937; font-size: 16px; font-weight: 600;">${applicationData.businessName}</p>
            
            <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Stall Type</p>
            <p style="margin: 5px 0 0 0; color: #1f2937; font-size: 16px; font-weight: 600;">${applicationData.stallType}</p>
          </div>

          <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 13px;">
            The event organizer will review your application and get back to you soon. You can check the status of your application from your dashboard.
          </p>
        </div>
      </div>
    `,
    text: `We have received your vendor application for ${applicationData.eventTitle}. The organizer will review it and get back to you soon.`,
  };
};

/**
 * Staff invite email — new account (with temp password) or promoted existing user.
 */
export const generateStaffInviteEmail = (data: {
  firstName: string;
  email: string;
  temporaryPassword?: string | null;
  loginUrl: string;
  staffHomeUrl: string;
}) => {
  const hasPassword = Boolean(data.temporaryPassword);
  return {
    subject: hasPassword
      ? 'You’re invited to PartyStorm Staff'
      : 'You’ve been added to PartyStorm Staff',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); padding: 28px; border-radius: 12px; text-align: center; color: white; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 26px; font-weight: 700;">PartyStorm</h1>
          <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Staff workspace invite</p>
        </div>

        <div style="background: #f9fafb; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb;">
          <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">
            Hi ${data.firstName},
          </p>
          <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">
            You’ve been set up as PartyStorm staff. Sign in, then switch to <strong>Staff mode</strong> to see covered events, scan tickets, and run walk-in sales.
          </p>

          ${
            hasPassword
              ? `
          <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 16px 0;">
            <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Login</p>
            <p style="margin: 0 0 4px 0; color: #111827; font-size: 14px;"><strong>Email:</strong> ${data.email}</p>
            <p style="margin: 0; color: #111827; font-size: 14px;"><strong>Temporary password:</strong> <span style="font-family: ui-monospace, monospace;">${data.temporaryPassword}</span></p>
            <p style="margin: 12px 0 0 0; color: #9f1239; font-size: 12px;">Change this password after your first login.</p>
          </div>
          `
              : `
          <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">
            Use your existing PartyStorm account password. No new password was created.
          </p>
          `
          }

          <div style="text-align: center; margin: 24px 0 8px;">
            <a href="${data.loginUrl}" style="display: inline-block; background: #f43f5e; color: white; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 22px; border-radius: 999px;">
              ${hasPassword ? 'Sign in' : 'Open PartyStorm'}
            </a>
          </div>
          <p style="margin: 12px 0 0 0; color: #6b7280; font-size: 12px; text-align: center;">
            Staff home: <a href="${data.staffHomeUrl}" style="color: #f43f5e;">${data.staffHomeUrl}</a>
          </p>
        </div>
      </div>
    `,
    text: hasPassword
      ? `Hi ${data.firstName}, you're invited to PartyStorm Staff. Login: ${data.email} / ${data.temporaryPassword}. Then switch to Staff mode: ${data.staffHomeUrl}`
      : `Hi ${data.firstName}, you've been added to PartyStorm Staff. Sign in and switch to Staff mode: ${data.staffHomeUrl}`,
  };
};

const supportShell = (title: string, bodyHtml: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); padding: 28px; border-radius: 12px; text-align: center; color: white; margin-bottom: 24px;">
      <h1 style="margin: 0; font-size: 26px; font-weight: 700;">PartyStorm</h1>
      <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">${title}</p>
    </div>
    <div style="background: #f9fafb; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb;">
      ${bodyHtml}
    </div>
  </div>
`;

export const generateSupportReceivedEmail = (data: {
  name?: string | null;
  subject: string;
  ticketId: number;
  supportUrl: string;
}) => {
  const greet = data.name?.trim() || 'there';
  return {
    subject: `We received your request (#${data.ticketId})`,
    html: supportShell(
      'Support request received',
      `
      <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">Hi ${greet},</p>
      <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">
        Thanks for contacting PartyStorm. We got your request and our team will follow up by email.
      </p>
      <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 16px 0;">
        <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; text-transform: uppercase;">Ticket #${data.ticketId}</p>
        <p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${data.subject}</p>
      </div>
      <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">
        Typical response time is 24–48 hours on business days. Reply to this email thread isn’t required — we’ll write you when there’s an update.
      </p>
      <div style="text-align: center; margin: 20px 0 0;">
        <a href="${data.supportUrl}" style="display: inline-block; background: #f43f5e; color: white; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 22px; border-radius: 999px;">
          Open support
        </a>
      </div>
      `
    ),
    text: `Hi ${greet}, we received your PartyStorm support request #${data.ticketId}: ${data.subject}. Track updates at ${data.supportUrl}`,
  };
};

export const generateSupportReplyEmail = (data: {
  name?: string | null;
  subject: string;
  ticketId: number;
  replyBody: string;
  needsMoreInfo?: boolean;
  supportUrl: string;
}) => {
  const greet = data.name?.trim() || 'there';
  const headline = data.needsMoreInfo
    ? 'We need a bit more information'
    : 'New reply from PartyStorm Support';
  return {
    subject: data.needsMoreInfo
      ? `More info needed — #${data.ticketId}: ${data.subject}`
      : `Support update — #${data.ticketId}: ${data.subject}`,
    html: supportShell(
      headline,
      `
      <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">Hi ${greet},</p>
      <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">
        ${
          data.needsMoreInfo
            ? 'Our support team needs a little more detail to help with your request:'
            : 'Our support team replied to your request:'
        }
      </p>
      <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #f43f5e; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px;">Ticket #${data.ticketId} · ${data.subject}</p>
        <p style="margin: 0; color: #111827; font-size: 14px; white-space: pre-wrap; line-height: 1.5;">${data.replyBody}</p>
      </div>
      <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">
        ${
          data.needsMoreInfo
            ? 'Please reply from your PartyStorm support page (sign in with this email if you have an account) or send another message from Contact / Support with the same email so we can match it.'
            : 'You can continue the conversation in your support inbox if you have a PartyStorm account.'
        }
      </p>
      <div style="text-align: center; margin: 20px 0 0;">
        <a href="${data.supportUrl}" style="display: inline-block; background: #f43f5e; color: white; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 22px; border-radius: 999px;">
          View ticket
        </a>
      </div>
      `
    ),
    text: `Hi ${greet}, PartyStorm Support update on #${data.ticketId} (${data.subject}):\n\n${data.replyBody}\n\n${data.supportUrl}`,
  };
};

export const generateSupportResolvedEmail = (data: {
  name?: string | null;
  subject: string;
  ticketId: number;
  note?: string | null;
  supportUrl: string;
}) => {
  const greet = data.name?.trim() || 'there';
  return {
    subject: `Resolved — #${data.ticketId}: ${data.subject}`,
    html: supportShell(
      'Your request was resolved',
      `
      <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">Hi ${greet},</p>
      <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px;">
        Good news — we’ve marked your support request as <strong>resolved</strong>.
      </p>
      <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 16px 0;">
        <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; text-transform: uppercase;">Ticket #${data.ticketId}</p>
        <p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${data.subject}</p>
        ${
          data.note?.trim()
            ? `<p style="margin: 12px 0 0 0; color: #374151; font-size: 14px; white-space: pre-wrap; line-height: 1.5;">${data.note.trim()}</p>`
            : ''
        }
      </div>
      <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 13px;">
        If something still isn’t right, open a new request from Support and mention ticket #${data.ticketId}.
      </p>
      <div style="text-align: center; margin: 20px 0 0;">
        <a href="${data.supportUrl}" style="display: inline-block; background: #f43f5e; color: white; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 22px; border-radius: 999px;">
          Open support
        </a>
      </div>
      `
    ),
    text: `Hi ${greet}, your PartyStorm support ticket #${data.ticketId} (${data.subject}) was resolved.${data.note ? `\n\n${data.note}` : ''}\n\n${data.supportUrl}`,
  };
};

export default {
  sendEmail,
  generateOTPEmail,
  generateTicketConfirmationEmail,
  generatePasswordResetEmail,
  generateWelcomeEmail,
  generateVendorApplicationEmail,
  generateStaffInviteEmail,
  generateSupportReceivedEmail,
  generateSupportReplyEmail,
  generateSupportResolvedEmail,
};
