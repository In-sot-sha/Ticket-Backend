import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import crypto from 'crypto';

// ── helpers ───────────────────────────────────────────────────────────────────

function generatePin(): string {
  // Cryptographically random 6-digit PIN
  return String(Math.floor(100000 + (crypto.randomInt(900000)))).padStart(6, '0');
}

// Derive the organiser's organisation id (first one they own)
async function getOrgId(userId: number): Promise<number | null> {
  const org = await prisma.organization.findFirst({ where: { ownerId: userId } });
  return org?.id ?? null;
}

// ── POST /gate-pins  — create a PIN for a named scanner ──────────────────────
export const createGatePin = async (req: AuthRequest, res: Response) => {
  try {
    const { staffName } = req.body as { staffName?: string };
    if (!staffName?.trim()) {
      return res.status(400).json({ message: 'staffName is required.' });
    }

    const orgId = await getOrgId(req.userId!);
    if (!orgId) {
      return res.status(403).json({ message: 'No organisation found. Create an event first.' });
    }

    // Generate a unique PIN (retry on collision)
    let pin = generatePin();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.gatePin.findFirst({ where: { pin, organizationId: orgId } });
      if (!existing) break;
      pin = generatePin();
      attempts++;
    }

    const record = await prisma.gatePin.create({
      data: {
        pin,
        staffName: staffName.trim(),
        organizationId: orgId,
        createdById: req.userId!,
      },
    });

    return res.status(201).json({ id: record.id, pin: record.pin, staffName: record.staffName });
  } catch (err) {
    console.error('[GatePin] createGatePin error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ── GET /gate-pins  — list all PINs for this organiser ───────────────────────
export const listGatePins = async (req: AuthRequest, res: Response) => {
  try {
    const orgId = await getOrgId(req.userId!);
    if (!orgId) return res.json([]);

    const pins = await prisma.gatePin.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, pin: true, staffName: true, createdAt: true },
    });

    return res.json(pins);
  } catch (err) {
    console.error('[GatePin] listGatePins error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ── DELETE /gate-pins/:id  — revoke a PIN ────────────────────────────────────
export const deleteGatePin = async (req: AuthRequest, res: Response) => {
  try {
    const pinId = Number(req.params.id);
    const orgId = await getOrgId(req.userId!);
    if (!orgId) return res.status(403).json({ message: 'Forbidden.' });

    const record = await prisma.gatePin.findFirst({ where: { id: pinId, organizationId: orgId } });
    if (!record) return res.status(404).json({ message: 'PIN not found.' });

    await prisma.gatePin.delete({ where: { id: pinId } });
    return res.json({ message: 'PIN revoked.' });
  } catch (err) {
    console.error('[GatePin] deleteGatePin error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ── POST /gate-pins/verify  — PUBLIC: validate a PIN before granting scanner access ──
export const verifyGatePin = async (req: Request, res: Response) => {
  try {
    const { pin } = req.body as { pin?: string };
    if (!pin || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({ message: 'A valid 6-digit PIN is required.' });
    }

    const record = await prisma.gatePin.findFirst({
      where: { pin },
      select: { id: true, staffName: true, organizationId: true },
    });

    if (!record) {
      return res.status(401).json({ message: 'Invalid PIN. Check the code and try again.' });
    }

    return res.json({ valid: true, staffName: record.staffName });
  } catch (err) {
    console.error('[GatePin] verifyGatePin error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};
