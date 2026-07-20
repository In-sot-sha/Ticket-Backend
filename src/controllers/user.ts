import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { generateToken, AuthRequest } from '../middleware/auth';
import { hashPassword, comparePassword } from '../utils/password';
import { uploadAvatarImage } from '../utils/imageUpload';
import { sendEmail, generateWelcomeEmail } from '../services/email';
import { isValidEmail, isValidName, normalizePhone } from '../utils/validation';
import { findUserByIdentifier } from '../services/guestUser';

const publicUser = (user: {
  id: number;
  email: string | null;
  phone?: string | null;
  firstName: string;
  lastName: string;
  role: string;
  isStaff?: boolean;
  mustChangePassword?: boolean;
  ownedOrganizations?: unknown[];
  vendorProfiles?: unknown[];
}) => ({
  id: user.id,
  email: user.email,
  phone: user.phone ?? null,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  isStaff: user.isStaff,
  mustChangePassword: user.mustChangePassword,
  ownedOrganizations: user.ownedOrganizations || [],
  vendorProfile: (user as { vendorProfiles?: unknown[] }).vendorProfiles?.[0] || null,
});

// ── Register ──────────────────────────────────────────────────────────────────

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!password || String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    if (!isValidName(firstName) || !isValidName(lastName)) {
      return res.status(400).json({ message: 'First and last name are required' });
    }

    const cleanEmail = email?.trim() ? String(email).trim().toLowerCase() : null;
    const cleanPhone = phone ? normalizePhone(String(phone)) : null;

    if (cleanEmail && !isValidEmail(cleanEmail)) {
      return res.status(400).json({ message: 'Invalid email address' });
    }
    if (phone && !cleanPhone) {
      return res.status(400).json({ message: 'Invalid phone number. Use a Nigerian number like 0803… or +234…' });
    }
    if (!cleanEmail && !cleanPhone) {
      return res.status(400).json({ message: 'Email or phone number is required' });
    }

    const existingByEmail = cleanEmail
      ? await prisma.user.findUnique({ where: { email: cleanEmail } })
      : null;
    const existingByPhone = cleanPhone
      ? await prisma.user.findUnique({ where: { phone: cleanPhone } })
      : null;

    // Prefer matching guest by email, else phone
    const existingUser = existingByEmail || existingByPhone;

    if (existingUser && !existingUser.isGuest) {
      if (existingByEmail && existingByEmail.id === existingUser.id) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }
      if (existingByPhone && existingByPhone.id === existingUser.id) {
        return res.status(400).json({ message: 'User with this phone number already exists' });
      }
      return res.status(400).json({ message: 'An account with these details already exists' });
    }

    // Conflict: email and phone belong to different non-guest-mergeable users
    if (
      existingByEmail &&
      existingByPhone &&
      existingByEmail.id !== existingByPhone.id &&
      (!existingByEmail.isGuest || !existingByPhone.isGuest)
    ) {
      return res.status(400).json({ message: 'Email and phone belong to different accounts' });
    }

    if (existingUser?.isGuest) {
      const hashedPassword = await hashPassword(password);
      const updatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          password: hashedPassword,
          isGuest: false,
          firstName: firstName || existingUser.firstName,
          lastName: lastName || existingUser.lastName,
          email: cleanEmail || existingUser.email,
          phone: cleanPhone || existingUser.phone,
        },
      });

      if (updatedUser.email) {
        const welcomeTemplate = generateWelcomeEmail(updatedUser.firstName);
        sendEmail({
          to: updatedUser.email,
          subject: welcomeTemplate.subject,
          html: welcomeTemplate.html,
          text: welcomeTemplate.text,
        }).catch((err) => console.error('[Register] Welcome email failed for converted guest:', err));
      }

      const token = generateToken(updatedUser.id, updatedUser.role);
      return res.status(200).json({
        message: 'Guest account converted to full account successfully',
        token,
        user: publicUser(updatedUser),
      });
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        phone: cleanPhone,
        password: hashedPassword,
        firstName,
        lastName,
        role: 'USER',
        isGuest: false,
      },
    });

    if (user.email) {
      const welcomeTemplate = generateWelcomeEmail(user.firstName);
      sendEmail({
        to: user.email,
        subject: welcomeTemplate.subject,
        html: welcomeTemplate.html,
        text: welcomeTemplate.text,
      }).catch((err) => console.error('[Register] Welcome email failed:', err));
    }

    const token = generateToken(user.id, user.role);
    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: publicUser(user),
    });
  } catch (error: any) {
    console.error(error);
    if (error?.code === 'P2002') {
      return res.status(400).json({ message: 'User with this email or phone already exists' });
    }
    return res.status(500).json({ message: 'Server error during registration' });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────

export const login = async (req: Request, res: Response) => {
  try {
    const { email, identifier, password } = req.body;
    const rawId = String(identifier || email || '').trim();

    if (!rawId || !password) {
      return res.status(400).json({ message: 'Email/phone and password are required' });
    }

    const found = await findUserByIdentifier(rawId);
    if (!found) {
      return res.status(400).json({ message: 'Invalid email/phone or password' });
    }

    const user = await prisma.user.findUnique({
      where: { id: found.id },
      include: { ownedOrganizations: true, vendorProfiles: true },
    });

    if (!user) return res.status(400).json({ message: 'Invalid email/phone or password' });
    if (!user.password) return res.status(400).json({ message: 'Please sign in with Google' });

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email/phone or password' });

    const token = generateToken(user.id, user.role);
    return res.json({
      message: 'Login successful',
      token,
      user: publicUser(user),
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
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, avatar: true, isVerified: true, isStaff: true, mustChangePassword: true, createdAt: true, ownedOrganizations: true, vendorProfiles: true },
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const { vendorProfiles, ...rest } = user as any;
    return res.json({ ...rest, vendorProfile: vendorProfiles?.[0] || null });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── Update profile ────────────────────────────────────────────────────────────

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, phone, avatar } = req.body;
    let cleanPhone: string | null | undefined = undefined;
    if (phone !== undefined) {
      if (!phone || !String(phone).trim()) {
        cleanPhone = null;
      } else {
        cleanPhone = normalizePhone(String(phone));
        if (!cleanPhone) {
          return res.status(400).json({ message: 'Invalid phone number' });
        }
      }
    }
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        firstName,
        lastName,
        ...(phone !== undefined ? { phone: cleanPhone } : {}),
        avatar,
      },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, avatar: true, isVerified: true, isStaff: true, mustChangePassword: true, createdAt: true, ownedOrganizations: true, vendorProfiles: true },
    });
    const { vendorProfiles, ...rest } = user as any;
    return res.json({ message: 'Profile updated successfully', user: { ...rest, vendorProfile: vendorProfiles?.[0] || null } });
  } catch (error: any) {
    console.error(error);
    if (error?.code === 'P2002') {
      return res.status(400).json({ message: 'This phone number is already in use' });
    }
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
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, avatar: true, isVerified: true, isStaff: true, mustChangePassword: true, createdAt: true, ownedOrganizations: true, vendorProfiles: true },
    });
    const { vendorProfiles, ...rest } = user as any;

    return res.json({ message: 'Avatar uploaded successfully', url: avatarUrl, user: { ...rest, vendorProfile: vendorProfiles?.[0] || null } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to upload avatar' });
  }
};

/** Change password — clears mustChangePassword when successful */
export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'currentPassword and newPassword are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.password) {
      return res.status(400).json({ message: 'This account uses social login and has no password to change' });
    }

    const ok = await comparePassword(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });

    const hashed = await hashPassword(newPassword);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, mustChangePassword: false },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        avatar: true,
        isVerified: true,
        isStaff: true,
        mustChangePassword: true,
        createdAt: true,
        ownedOrganizations: true,
        vendorProfiles: true,
      },
    });
    const { vendorProfiles, ...rest } = updated as any;
    return res.json({
      message: 'Password updated successfully',
      user: { ...rest, vendorProfile: vendorProfiles?.[0] || null },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
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
    cacheMaxAge:      60 * 60 * 1000, // 1 hour — reduces JWKS fetches for Google login
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

    // Track if this is a new user
    let isNewUser = false;

    // Find or create the user
    let user = await prisma.user.findUnique({
      where: { authProviderId: sub },
      include: { ownedOrganizations: true, vendorProfiles: true },
    });

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email },
        include: { ownedOrganizations: true, vendorProfiles: true },
      });

      if (user) {
        // Link existing local account to this OAuth identity
        user = await prisma.user.update({
          where: { id: user.id },
          data: { authProvider: 'google', authProviderId: sub, isVerified: user.isVerified || emailVerified },
          include: { ownedOrganizations: true, vendorProfiles: true },
        });
      } else {
        // Brand-new user
        user = await prisma.user.create({
          data: { email, firstName: given_name, lastName: family_name, avatar: picture, role: 'USER', isVerified: emailVerified, authProvider: 'google', authProviderId: sub },
          include: { ownedOrganizations: true, vendorProfiles: true },
        });
        isNewUser = true;
      }
    }

    // Send welcome email for new Google users (fire-and-forget)
    if (isNewUser && user.email) {
      const welcomeTemplate = generateWelcomeEmail(user.firstName);
      sendEmail({
        to: user.email,
        subject: welcomeTemplate.subject,
        html: welcomeTemplate.html,
        text: welcomeTemplate.text,
      }).catch(err => console.error('[GoogleLogin] Welcome email failed for new user:', err));
    }

    const token = generateToken(user.id, user.role);
    return res.json({
      message: 'Google login successful',
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error('[googleLogin] Error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};

// ── Refresh Token ────────────────────────────────────────────────────────────

/**
 * Refresh JWT token for users with expired or expiring tokens
 * This endpoint does NOT require a valid token - it works with expired tokens
 * Client sends: { token: "expired_jwt_token" } OR { refreshToken: "refresh_token_string" }
 * 
 * This implements Airbnb-style silent refresh:
 * - Can accept either access token (even if expired) or refresh token
 * - Returns new access token + optional new refresh token
 * - Client uses this to proactively refresh before expiration
 */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { token, refreshToken: refreshTokenBody } = req.body;

    if (!token && !refreshTokenBody) {
      return res.status(401).json({ message: 'Token or refreshToken is required' });
    }

    // Verify token WITHOUT checking expiration to get userId/role
    let decoded: any;
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return res.status(500).json({ message: 'Server configuration error' });
      }
      
      // Try access token first, then refresh token
      const tokenToVerify = token || refreshTokenBody;
      
      // Use ignoreExpiration to allow refresh of expired tokens
      decoded = jwt.verify(tokenToVerify, secret, { ignoreExpiration: true });
    } catch (error) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const { userId, role } = decoded;

    if (!userId || !role) {
      return res.status(401).json({ message: 'Invalid token claims' });
    }

    // Verify user still exists in database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { vendorProfiles: true }
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Check if user is still active (not deleted/suspended)
    if (!user.email) {
      return res.status(401).json({ message: 'User account invalid' });
    }

    // Generate new tokens
    const newAccessToken = generateToken(userId, role);
    
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ message: 'Server configuration error' });
    }
    
    // Optionally generate a new refresh token (with longer expiry)
    const newRefreshToken = jwt.sign(
      { userId, role, type: 'refresh' },
      secret,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d' } as jwt.SignOptions
    );

    return res.json({
      message: 'Token refreshed successfully',
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isStaff: user.isStaff,
        mustChangePassword: user.mustChangePassword,
        avatar: user.avatar,
        vendorProfile: user.vendorProfiles?.[0] || null
      }
    });
  } catch (error) {
    console.error('[refreshToken] Error:', error);
    return res.status(500).json({ message: 'Server error during token refresh' });
  }
};
