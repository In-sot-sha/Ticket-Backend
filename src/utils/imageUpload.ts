import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import cloudinary from '../config/cloudinary';

function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

function localImageUrl(req: Request, filename: string): string {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT || 33312}`;
  return `${protocol}://${host}/uploads/${filename}`;
}

/**
 * Upload an image to Cloudinary when configured, otherwise keep it locally.
 */
export async function uploadImage(
  file: Express.Multer.File,
  req: Request,
  folder: string
): Promise<string> {
  const absolutePath = path.isAbsolute(file.path)
    ? file.path
    : path.join(process.cwd(), file.path);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Upload file not found at ${absolutePath}`);
  }

  if (isCloudinaryConfigured()) {
    try {
      const result = await cloudinary.uploader.upload(absolutePath, {
        folder,
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      });

      fs.unlinkSync(absolutePath);
      return result.secure_url;
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      console.warn('Falling back to local image storage.');
    }
  } else {
    console.warn('Cloudinary not configured — storing image locally.');
  }

  const publicUploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(publicUploadsDir)) {
    fs.mkdirSync(publicUploadsDir, { recursive: true });
  }
  const destPath = path.join(publicUploadsDir, file.filename);
  fs.copyFileSync(absolutePath, destPath);
  try {
    fs.unlinkSync(absolutePath);
  } catch {
    // temp file may already be removed
  }

  return localImageUrl(req, file.filename);
}

/**
 * Upload an event image to Cloudinary when configured, otherwise keep it locally.
 */
export async function uploadEventImage(
  file: Express.Multer.File,
  req: Request
): Promise<string> {
  return uploadImage(file, req, 'event_images');
}

export async function uploadAvatarImage(
  file: Express.Multer.File,
  req: Request
): Promise<string> {
  return uploadImage(file, req, 'avatars');
}

export async function uploadOrgLogoImage(
  file: Express.Multer.File,
  req: Request
): Promise<string> {
  return uploadImage(file, req, 'org_logos');
}
