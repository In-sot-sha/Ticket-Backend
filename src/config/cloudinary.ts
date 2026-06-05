import cloudinary from 'cloudinary';
import * as dotenv from 'dotenv';

dotenv.config();

// Validate that all required environment variables are set
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error('Missing Cloudinary configuration. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file.');
  
  // In a production environment, you might want to exit the process
  // For development, we'll configure with empty values to avoid crashes
  cloudinary.v2.config({
    cloud_name: cloudName || '',
    api_key: apiKey || '',
    api_secret: apiSecret || '',
  });
} else {
  cloudinary.v2.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

export default cloudinary.v2;