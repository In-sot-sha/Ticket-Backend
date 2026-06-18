import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { generateToken, AuthRequest } from '../middleware/auth';
import { hashPassword, comparePassword } from '../utils/password';
import { uploadAvatarImage } from '../utils/imageUpload';

// ── Register ──────────────────────────────────────────────────────────────────

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ message: 'User with this email already exists' });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, firstName, lastName, phone, role: 'USER' },
    });

    const token = generateToken(user.id, user.role);
    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, ownedOrganizations: [] },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during registration' });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { ownedOrganizations: true },
    });

    if (!user) return res.status(400).json({ message: 'Invalid email or password' });
    if (!user.password) return res.status(400).json({ message: 'Please sign in with Google' });

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    const token = generateToken(user.id, user.role);
    return res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, ownedOrganizations: user.ownedOrganizations || [] },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};

// ── Get profile ───────────────────────────────────────────────────────────────

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, avatar: true, isVerified: true, createdAt: true, ownedOrganizations: true },
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── Update profile ────────────────────────────────────────────────────────────

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, phone, avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { firstName, lastName, phone, avatar },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, avatar: true, isVerified: true, createdAt: true, ownedOrganizations: true },
    });
    return res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const uploadAvatar = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const avatarUrl = await uploadAvatarImage(req.file, req);
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { avatar: avatarUrl },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, avatar: true, isVerified: true, createdAt: true, ownedOrganizations: true },
    });

    return res.json({ message: 'Avatar uploaded successfully', url: avatarUrl, user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to upload avatar' });
  }
};

// ── JWKS client (lazy-initialised, cached across Lambda invocations) ──────────

let _jwksClient: jwksClient.JwksClient | null = null;

function getJwksClient(): jwksClient.JwksClient {
  if (_jwksClient) return _jwksClient;

  // Priority:
  //   1. NEON_JWKS_URL    — full explicit URL
  //   2. NEON_ISSUER      — append /.well-known/jwks.json
  let jwksUri: string;

  if (process.env.NEON_JWKS_URL) {
    jwksUri = process.env.NEON_JWKS_URL;
  } else if (process.env.NEON_ISSUER) {
    const base = process.env.NEON_ISSUER.replace(/\/$/, '');
    jwksUri = `${base}/auth/.well-known/jwks.json`;
  } else {
    throw new Error(
      'Neither NEON_JWKS_URL nor NEON_ISSUER is set. ' +
      'Add NEON_ISSUER to your environment variables.'
    );
  }

  console.log('[JWKS] Using URI:', jwksUri);

  _jwksClient = jwksClient({
    jwksUri,
    cache:            true,
    cacheMaxEntries:  5,
    cacheMaxAge:      10 * 60 * 1000, // 10 minutes
    rateLimit:        true,
    jwksRequestsPerMinute: 10,
  });

  return _jwksClient;
}

/**
 * Verify a Neon Auth / Stack Auth JWT.
 *
 * Neon Auth (Stack Auth) tokens can use EdDSA (Ed25519), ES256, or RS256.
 * jsonwebtoken does NOT support EdDSA, so we detect the algorithm first:
 *   - EdDSA → verify manually using Node's crypto (Ed25519 is built-in since Node 15)
 *   - RSA / EC → use jsonwebtoken (well-tested, handles all edge cases)
 */
function verifyNeonToken(token: string): Promise<Record<string, unknown>> {
  // Decode header without verification to get the algorithm
  const parts = token.split('.');
  if (parts.length !== 3) return Promise.reject(new Error('Malformed JWT'));

  let header: any;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  } catch {
    return Promise.reject(new Error('Could not decode JWT header'));
  }

  const alg: string = (header.alg ?? '').toUpperCase();

  // EdDSA (Ed25519) — jsonwebtoken doesn't support it, use Node crypto directly
  if (alg === 'EDDSA') {
    return verifyEdDSA(token, header.kid);
  }

  // RS256/ES256/etc. — use jsonwebtoken + jwks-rsa
  return verifyWithJwksRsa(token);
}

/** Verify an EdDSA (Ed25519) JWT using Node's built-in crypto. */
async function verifyEdDSA(token: string, kid: string): Promise<Record<string, unknown>> {
  const parts    = token.split('.');
  const payload  = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  const client   = getJwksClient();

  // Fetch the signing key
  const key = await new Promise<jwksClient.SigningKey>((resolve, reject) => {
    client.getSigningKey(kid, (err, k) => {
      if (err || !k) return reject(err ?? new Error('Signing key not found'));
      resolve(k);
    });
  });

  // jwks-rsa gives us the public key as PEM
  const pubKeyPem = key.getPublicKey();
  const pubKey    = crypto.createPublicKey(pubKeyPem);

  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature    = Buffer.from(parts[2], 'base64url');

  // Ed25519 verify — no hash algorithm needed (Ed25519 is its own hash)
  const valid = crypto.verify(null, Buffer.from(signingInput), pubKey, signature);
  if (!valid) throw new Error('EdDSA signature verification failed');

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('JWT has expired');

  return payload as Record<string, unknown>;
}

/** Verify RS256/ES256/etc. using jsonwebtoken + jwks-rsa. */
function verifyWithJwksRsa(token: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const client = getJwksClient();

    const getKey: jwt.GetPublicKeyOrSecret = (header, callback) => {
      if (!header.kid) return callback(new Error('JWT header missing kid'));
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key?.getPublicKey());
      });
    };

    jwt.verify(
      token,
      getKey,
      { algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'] },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as Record<string, unknown>);
      }
    );
  });
}

// ── Google / Neon Auth login ──────────────────────────────────────────────────

export const googleLogin = async (req: Request, res: Response) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ message: 'Credential is required' });
    }

    let payload: Record<string, unknown>;
    try {
      payload = await verifyNeonToken(credential);
    } catch (err: any) {
      console.error('[googleLogin] Token verification failed:', err.message);
      return res.status(400).json({ message: 'Invalid credential: ' + err.message });
    }

    const email:         string        = payload.email as string;
    const sub:           string        = payload.sub   as string;
    const emailVerified: boolean       = Boolean(payload.email_verified ?? payload.emailVerified);
    const fullName:      string        = (payload.name as string) ?? 'Google User';
    const nameParts                    = fullName.split(' ');
    const given_name:    string        = (payload.given_name  as string) ?? nameParts[0]              ?? 'Google';
    const family_name:   string        = (payload.family_name as string) ?? nameParts.slice(1).join(' ') ?? 'User';
    const picture:       string | null = (payload.picture as string) ?? null;

    if (!email || !sub) {
      return res.status(400).json({ message: 'Email or identity not provided' });
    }

    // Find or create the user
    let user = await prisma.user.findUnique({
      where: { authProviderId: sub },
      include: { ownedOrganizations: true },
    });

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email },
        include: { ownedOrganizations: true },
      });

      if (user) {
        // Link existing local account to this OAuth identity
        user = await prisma.user.update({
          where: { id: user.id },
          data: { authProvider: 'google', authProviderId: sub, isVerified: user.isVerified || emailVerified },
          include: { ownedOrganizations: true },
        });
      } else {
        // Brand-new user
        user = await prisma.user.create({
          data: { email, firstName: given_name, lastName: family_name, avatar: picture, role: 'USER', isVerified: emailVerified, authProvider: 'google', authProviderId: sub },
          include: { ownedOrganizations: true },
        });
      }
    }

    const token = generateToken(user.id, user.role);
    return res.json({
      message: 'Google login successful',
      token,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, avatar: user.avatar, ownedOrganizations: user.ownedOrganizations || [] },
    });
  } catch (error) {
    console.error('[googleLogin] Error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};
