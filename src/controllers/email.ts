import { Request, Response } from 'express';
import { sendEmail, generateOTPEmail, generateWelcomeEmail, generateTicketConfirmationEmail } from '../services/email';
import { createOTP, verifyOTP, consumeOTP, isOTPVerified } from '../services/otp';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import validator from 'email-validator';

// ── Email validation helper ──────────────────────────────────────────────────

const isValidEmail = (email: string): boolean => {
  return validator.validate(email);
};

// ── POST /emails/send-otp  — Send OTP to email (public, rate-limited recommended) ──
export const sendOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required.' });
    }

    // Check if email already exists (for registration flow)
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered. Please log in.' });
    }

    // Generate OTP
    const { code, expiresIn } = createOTP(email);

    // Send OTP email
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

// ── POST /emails/verify-otp  — Verify OTP code (public) ──────────────────────
export const verifyEmailOTP = async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body as { email?: string; code?: string };

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required.' });
    }

    if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
      return res.status(400).json({ message: 'Valid 6-digit OTP is required.' });
    }

    // Verify the OTP
    const result = verifyOTP(email, code);

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

// ── POST /emails/send-welcome  — Send welcome email after signup ────────────
export const sendWelcomeEmail = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Send welcome email
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

// ── POST /emails/send-ticket-confirmation  — Send ticket purchase confirmation ──
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

    // Fetch ticket details
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

    // Verify ownership
    if (ticket.userId !== userId) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    // Check if user exists
    if (!ticket.user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Format event date
    const eventDate = new Date(ticket.event.startDate).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Send ticket confirmation email
    const emailTemplate = generateTicketConfirmationEmail(ticket.user.email, {
      ticketId: `TKT-${ticket.id.toString().padStart(6, '0')}`,
      eventTitle: ticket.event.title,
      eventDate,
      eventLocation: ticket.event.location || 'Online',
      ticketType: ticket.ticketType?.name || 'General Admission',
      quantity: 1,
      totalPrice: ticket.ticketType?.price || 0,
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

// ── POST /emails/test  — Test email sending (dev only) ─────────────────────
export const testEmail = async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ message: 'Test endpoint not available in production.' });
    }

    const { email } = req.body as { email?: string };

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required.' });
    }

    const sent = await sendEmail({
      to: email,
      subject: 'PartyStorm Email Test 📧',
      html: `
        <div style="font-family: sans-serif; padding: 20px; background: #f5f5f5; border-radius: 8px;">
          <h2>Email Test Successful!</h2>
          <p>If you received this, PartyStorm email service is working correctly.</p>
          <p>Sent at: ${new Date().toISOString()}</p>
        </div>
      `,
    });

    if (!sent) {
      return res.status(500).json({ message: 'Failed to send test email.' });
    }

    return res.status(200).json({ message: 'Test email sent successfully.' });
  } catch (error: any) {
    console.error('[Email] testEmail error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
};
