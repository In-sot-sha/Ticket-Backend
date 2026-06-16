const fs = require('fs');
const path = require('path');

// Load environment variables from .env if running locally
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

// Check for Vercel's prefixed variable first, then fallback to local
const isVercel = !!process.env.ticket_DATABASE_URL;
const dbUrl = process.env.ticket_DATABASE_URL || process.env.DATABASE_URL || '';

let provider = 'mysql'; // Default
if (dbUrl.startsWith('postgres')) {
  provider = 'postgresql';
} else if (dbUrl.startsWith('mongodb')) {
  provider = 'mongodb';
}

console.log(`[Prisma setup] Detected ${provider} from URL`);

schema = schema.replace(
  /datasource\s+db\s*\{[^}]*provider\s*=\s*"[^"]+"/,
  (match) => match.replace(/provider\s*=\s*"[^"]+"/, `provider = "${provider}"`)
);

// If on Vercel with the prefix, update the schema url to look for it
if (isVercel) {
  schema = schema.replace(
    /url\s*=\s*env\("DATABASE_URL"\)/,
    `url      = env("ticket_DATABASE_URL")`
  );
  console.log(`[Prisma setup] Updated schema to use env("ticket_DATABASE_URL")`);
}

fs.writeFileSync(schemaPath, schema);
console.log(`[Prisma setup] Updated schema.prisma to use ${provider}`);
