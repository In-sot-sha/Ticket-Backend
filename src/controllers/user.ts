import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { generateToken, AuthRequest } from '../middleware/auth';
import { hashPassword, comparePassword } from '../utils/password';

// Register a new user
export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      res.status(400).json({ message: 'User with this email already exists' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Create the user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        role: 'USER' // Default role
      }
    });

    // Generate token
    const token = generateToken(user.id, user.role);

   return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        ownedOrganizations: []
      }
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during registration' });

  }
};

// Login user
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        ownedOrganizations: true
      }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });

    }

    if (!user.password) {
      return res.status(400).json({ message: 'Please sign in with Google/Neon' });
    }

    // Compare password
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Generate token
    const token = generateToken(user.id, user.role);

   return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        ownedOrganizations: user.ownedOrganizations || []
      }
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};

// Get user profile
export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        avatar: true,
        isVerified: true,
        createdAt: true,
        ownedOrganizations: true
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json(user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Update user profile
export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, phone, avatar } = req.body;

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        firstName,
        lastName,
        phone,
        avatar
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        avatar: true,
        isVerified: true,
        createdAt: true,
        ownedOrganizations: true
      }
    });

    return res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};



const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;


// Neon Auth Login/Register
export const googleLogin = async (req: Request, res: Response) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ message: 'Credential is required' });
    }

    // Decode just the payload to get the issuer (without verification)
    const parts = credential.split('.');
    if (parts.length !== 3) {
      return res.status(400).json({ message: 'Invalid token format' });
    }
    const rawPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const iss = rawPayload.iss;

    console.log('[neonLogin] Token iss:', iss);
    console.log('[neonLogin] NEON_PROJECT_ID:', NEON_PROJECT_ID);

    if (!iss) {
      return res.status(400).json({ message: 'Token has no issuer' });
    }

    // Neon Auth JWKS lives at {base}/neondb/auth/.well-known/jwks.json
    const baseUrl = iss.endsWith('/') ? iss.slice(0, -1) : iss;
    const jwksUrl = new URL(`${baseUrl}/neondb/auth/.well-known/jwks.json`);
    console.log('[neonLogin] JWKS URI:', jwksUrl.toString());

    const jose = await import('jose');
    const JWKS = jose.createRemoteJWKSet(jwksUrl);

    let email, given_name, family_name, picture, email_verified, sub;

    try {
      const { payload: verifiedPayload } = await jose.jwtVerify(credential, JWKS);
      
      console.log('[neonLogin] ✅ Token verified! email:', verifiedPayload.email, 'sub:', verifiedPayload.sub);
      email = verifiedPayload.email as string;
      sub = verifiedPayload.sub;
      const nameParts = ((verifiedPayload.name as string) || (verifiedPayload as any).raw_user_meta_data?.name || 'Google User').split(' ');
      given_name = nameParts[0];
      family_name = nameParts.slice(1).join(' ');
      picture = (verifiedPayload.picture as string) || (verifiedPayload as any).raw_user_meta_data?.picture || null;
      email_verified = Boolean(verifiedPayload.emailVerified);
    } catch (err: any) {
      console.error('[neonLogin] ❌ Verification failed:', err.message);
      return res.status(400).json({ message: 'Invalid credential: ' + err.message });
    }

    if (!email || !sub) {
      return res.status(400).json({ message: 'Email or identity not provided by Auth account' });
    }

    // Attempt to find by provider ID first
    let user = await prisma.user.findUnique({
      where: { authProviderId: sub },
      include: { ownedOrganizations: true }
    });

    if (!user) {
      // If not found by sub, check if local user exists with the same email
      user = await prisma.user.findUnique({
        where: { email },
        include: { ownedOrganizations: true }
      });

      if (user) {
        // Link the existing local account to this Neon identity
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            authProvider: 'neon',
            authProviderId: sub,
            isVerified: user.isVerified || email_verified
          },
          include: { ownedOrganizations: true }
        });
      } else {
        // Create a new user without a password
        user = await prisma.user.create({
          data: {
            email,
            firstName: given_name || 'Google',
            lastName: family_name || 'User',
            avatar: picture || null,
            role: 'USER',
            isVerified: email_verified,
            authProvider: 'neon',
            authProviderId: sub
          },
          include: { ownedOrganizations: true }
        });
      }
    }

    // Generate token
    const token = generateToken(user.id, user.role);

    return res.json({
      message: 'Google login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar,
        ownedOrganizations: user.ownedOrganizations || []
      }
    });

  } catch (error) {
    console.error('Neon Auth error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};