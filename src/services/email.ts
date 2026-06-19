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
  }
) => {
  return {
    subject: `Your Tickets for ${ticketData.eventTitle}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f43f5e 0%, #ec4899 100%); padding: 30px; border-radius: 12px; text-align: center; color: white; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">PartyStorm</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Ticket Confirmation</p>
        </div>

        <div style="background: #f9fafb; padding: 25px; border-radius: 12px; border: 1px solid #e5e7eb; margin-bottom: 20px;">
          <p style="margin: 0 0 20px 0; color: #374151; font-size: 14px;">
            Great! Your tickets for <strong>${ticketData.eventTitle}</strong> have been confirmed.
          </p>

          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #f43f5e;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
              <div>
                <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Ticket ID</p>
                <p style="margin: 5px 0 0 0; color: #1f2937; font-size: 16px; font-weight: 600;">${ticketData.ticketId}</p>
              </div>
              <div>
                <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Quantity</p>
                <p style="margin: 5px 0 0 0; color: #1f2937; font-size: 16px; font-weight: 600;">${ticketData.quantity} ticket(s)</p>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <div>
                <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Date & Time</p>
                <p style="margin: 5px 0 0 0; color: #1f2937; font-size: 14px; font-weight: 600;">${ticketData.eventDate}</p>
              </div>
              <div>
                <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Location</p>
                <p style="margin: 5px 0 0 0; color: #1f2937; font-size: 14px; font-weight: 600;">${ticketData.eventLocation}</p>
              </div>
            </div>
          </div>

          <div style="background: white; padding: 15px; border-radius: 8px; margin-top: 15px; text-align: center;">
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Ticket Type</p>
            <p style="margin: 0; color: #1f2937; font-size: 16px; font-weight: 600;">${ticketData.ticketType}</p>
          </div>

          <div style="background: linear-gradient(135deg, #fef2f2 0%, #fff5f7 100%); padding: 15px; border-radius: 8px; margin-top: 15px; border: 1px solid #fee2e2;">
            <p style="margin: 0 0 5px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Total</p>
            <p style="margin: 0; color: #f43f5e; font-size: 24px; font-weight: 700;">₦${ticketData.totalPrice.toLocaleString()}</p>
          </div>

          <div style="background: #dbeafe; padding: 15px; border-radius: 8px; margin-top: 15px; border-left: 4px solid #3b82f6;">
            <p style="margin: 0; color: #1e40af; font-size: 14px;">
              ✓ Your QR code has been emailed separately. Save it to your phone or print it.
            </p>
          </div>

          <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 13px;">
            You can view, download, and manage your tickets anytime by logging into your PartyStorm account.
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">

          <p style="margin: 0; color: #6b7280; font-size: 12px;">
            Questions? <a href="mailto:support@partystorm.com" style="color: #f43f5e; text-decoration: none;">Contact our support team</a>
          </p>
        </div>

        <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
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

export default {
  sendEmail,
  generateOTPEmail,
  generateTicketConfirmationEmail,
  generatePasswordResetEmail,
  generateWelcomeEmail,
};
