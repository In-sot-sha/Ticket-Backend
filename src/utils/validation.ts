/**
 * Input validation utilities for security
 */

/**
 * Validate email format
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
};

/**
 * Validate URL format
 */
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Strip formatting from a phone string, keeping digits and a leading +.
 */
export const stripPhone = (phone: string): string => {
  if (!phone) return '';
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
};

/**
 * Normalize phone to E.164-ish for Nigeria: +234XXXXXXXXXX
 * Accepts 0803..., 803..., 234803..., +234803...
 */
export const normalizePhone = (phone: string): string | null => {
  if (!phone || typeof phone !== 'string') return null;
  const raw = stripPhone(phone);
  if (!raw) return null;

  let digits = raw.startsWith('+') ? raw.slice(1) : raw;

  if (digits.startsWith('234') && digits.length === 13) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `+234${digits.slice(1)}`;
  }
  if (digits.length === 10 && /^[789]/.test(digits)) {
    return `+234${digits}`;
  }
  // Already E.164-ish international (7–15 digits after country handling)
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
};

/**
 * Validate phone number — prefers Nigerian mobile formats, allows general E.164.
 */
export const isValidPhone = (phone: string): boolean => {
  return normalizePhone(phone) !== null;
};

/**
 * True if the string looks like an email rather than a phone identifier.
 */
export const looksLikeEmail = (value: string): boolean => {
  return typeof value === 'string' && value.includes('@');
};

/**
 * Sanitize string input - remove/limit special chars to prevent injection
 */
export const sanitizeString = (input: string, maxLength: number = 255): string => {
  if (!input) return '';
  // Remove null bytes and control characters
  const sanitized = input
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();
  
  return sanitized.substring(0, maxLength);
};

/**
 * Validate name (first/last name)
 */
export const isValidName = (name: string, minLength: number = 1, maxLength: number = 100): boolean => {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength;
};

/**
 * Validate password strength
 */
export const isValidPassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate numeric ID
 */
export const isValidId = (id: any): boolean => {
  const num = Number(id);
  return !isNaN(num) && num > 0 && Number.isInteger(num);
};

/**
 * Validate UUID v4 format
 */
export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Batch validate object fields
 */
export const validateFields = (
  obj: Record<string, any>,
  schema: Record<string, (value: any) => boolean>
): { valid: boolean; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};

  for (const [field, validator] of Object.entries(schema)) {
    if (!validator(obj[field])) {
      errors[field] = `Invalid value for field: ${field}`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
};
