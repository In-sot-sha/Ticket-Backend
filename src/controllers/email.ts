import { Request, Response } from 'express';
import {
  sendEmail,
  generateOTPEmail,
  generateWelcomeEmail,
  generateTicketConfirmationEmail,
  emailLayout,
  getEmailPreview,
  EMAIL_PREVIEW_IDS,
  type EmailPreviewId,
} from '../services/email';
import { createOTP, verifyOTP } from '../services/otp';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import validator from 'email-validator';

const isValidEmail = (email: string): boolean => validator.validate(email);

export const sendOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered. Please log in.' });
    }

    const { code, expiresIn } = await createOTP(email);
    const emailTemplate = generateOTPEmail(email, code, expiresIn);
    const sent = await sendEmail({
      to: email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    if (!sent) {
      return res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
    }

    return res.status(200).json({
      message: 'OTP sent successfully. Check your email.',
      expiresIn,
    });
  } catch (error: any) {
    console.error('[Email] sendOTP error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

export const verifyEmailOTP = async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body as { email?: string; code?: string };

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required.' });
    }

    if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
      return res.status(400).json({ message: 'Valid 6-digit OTP is required.' });
    }

    const result = await verifyOTP(email, code);

    if (!result.valid) {
      return res.status(400).json({ message: result.message });
    }

    return res.status(200).json({
      valid: true,
      message: 'OTP verified successfully.',
    });
  } catch (error: any) {
    console.error('[Email] verifyEmailOTP error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

export const sendWelcomeEmail = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (!user.email) {
      return res.status(400).json({ message: 'This account has no email on file.' });
    }

    const emailTemplate = generateWelcomeEmail(user.firstName || 'there');
    const sent = await sendEmail({
      to: user.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    if (!sent) {
      return res.status(500).json({ message: 'Failed to send welcome email.' });
    }

    return res.status(200).json({ message: 'Welcome email sent.' });
  } catch (error: any) {
    console.error('[Email] sendWelcomeEmail error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

export const sendTicketConfirmation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const { ticketId, eventId } = req.body as { ticketId?: number; eventId?: number };

    if (!ticketId || !eventId) {
      return res.status(400).json({ message: 'ticketId and eventId are required.' });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: true,
        user: true,
        ticketType: true,
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }

    if (ticket.userId !== userId) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    if (!ticket.user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const eventDate = new Date(ticket.event.startDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (!ticket.user?.email) {
      return res.status(400).json({ message: 'This ticket has no email on file.' });
    }

    const emailTemplate = generateTicketConfirmationEmail(ticket.user.email, {
      ticketId: `TKT-${ticket.id.toString().padStart(6, '0')}`,
      eventTitle: ticket.event.title,
      eventDate,
      eventLocation: ticket.event.location || 'Online',
      ticketType: ticket.ticketType?.name || 'General Admission',
      quantity: 1,
      totalPrice: ticket.ticketType?.price || 0,
      qrCode: ticket.qrCode || undefined,
      ticketStyle: ticket.ticketType?.ticketStyle,
      accentColor: ticket.ticketType?.accentColor,
    });

    const sent = await sendEmail({
      to: ticket.user.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    if (!sent) {
      return res.status(500).json({ message: 'Failed to send confirmation email.' });
    }

    return res.status(200).json({ message: 'Ticket confirmation email sent.' });
  } catch (error: any) {
    console.error('[Email] sendTicketConfirmation error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

export const testEmail = async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ message: 'Test endpoint not available in production.' });
    }

    const { email } = req.body as { email?: string };

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required.' });
    }

    const html = emailLayout({
      eyebrow: 'Email test',
      preheader: 'PartyStorm email service test',
      bodyHtml: `
        <p style="margin:0 0 12px 0;"><strong>Email test successful.</strong></p>
        <p style="margin:0;color:#52525b;">If you received this, PartyStorm mail is working. Sent at ${new Date().toISOString()}.</p>
      `,
    });

    const sent = await sendEmail({
      to: email,
      subject: 'PartyStorm Email Test',
      html,
      text: `PartyStorm email test at ${new Date().toISOString()}`,
    });

    if (!sent) {
      return res.status(500).json({
        message:
          'Failed to send. Set RESEND_API_KEY (recommended) or EMAIL_USER + EMAIL_PASS.',
      });
    }

    return res.status(200).json({ message: 'Test email sent successfully.' });
  } catch (error: any) {
    console.error('[Email] testEmail error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};

/**
 * GET /emails/preview — list templates
 * GET /emails/preview/:id — HTML preview (open in browser)
 * Dev: open. Production: ADMIN only.
 */
export const listEmailPreviews = async (_req: Request, res: Response) => {
  return res.json({
    templates: EMAIL_PREVIEW_IDS,
    hint: 'Open /api/emails/preview/{id} in a browser to view HTML.',
  });
};

export const previewEmail = async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || '') as EmailPreviewId;
    if (!EMAIL_PREVIEW_IDS.includes(id)) {
      return res.status(404).json({
        message: `Unknown template. Use one of: ${EMAIL_PREVIEW_IDS.join(', ')}`,
      });
    }

    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev && req.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Admin only in production.' });
    }

    const tpl = getEmailPreview(id);
    const format = String(req.query.format || 'html');

    if (format === 'json') {
      return res.json({ id, subject: tpl.subject, text: tpl.text, html: tpl.html });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(tpl.html);
  } catch (error: any) {
    console.error('[Email] previewEmail error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};
