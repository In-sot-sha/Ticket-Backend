const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

const dbUrl = process.env.DATABASE_URL || '';

let provider = 'mysql'; // Default
if (dbUrl.startsWith('postgres')) {
  provider = 'postgresql';
} else if (dbUrl.startsWith('mongodb')) {
  provider = 'mongodb';
}

console.log(`[Prisma setup] Detected ${provider} from DATABASE_URL`);

schema = schema.replace(
  /provider\s*=\s*"[^"]+"/,
  `provider = "${provider}"`
);

fs.writeFileSync(schemaPath, schema);
console.log(`[Prisma setup] Updated schema.prisma to use ${provider}`);
