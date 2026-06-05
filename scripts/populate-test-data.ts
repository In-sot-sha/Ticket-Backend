// Script to populate the database with initial data for testing
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create a test user
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      password: 'hashedpassword123', // In real app, this would be hashed
      firstName: 'Test',
      lastName: 'User',
      role: 'USER',
      isVerified: true,
    },
  });

  console.log('Created user:', user);

  // Create an organization for the user
  const organization = await prisma.organization.create({
    data: {
      name: 'Test Organization',
      description: 'A test organization for events',
      ownerId: user.id,
      isVerified: true,
    },
  });

  console.log('Created organization:', organization);

  // Add the user as a member of their own organization
  const orgMember = await prisma.organizationMember.create({
    data: {
      userId: user.id,
      organizationId: organization.id,
      role: 'admin',
    },
  });

  console.log('Created organization member:', orgMember);

  // Create a test event
  const event = await prisma.event.create({
    data: {
      title: 'Test Event',
      description: 'A sample event for testing',
      startDate: new Date(),
      endDate: new Date(new Date().getTime() + 2 * 60 * 60 * 1000), // 2 hours later
      location: 'Test Location',
      locationType: 'physical',
      organizationId: organization.id,
      isPublished: true,
      price: 50.0,
      capacity: 100,
    },
  });

  console.log('Created event:', event);

  // Create a ticket type for the event
  const ticketType = await prisma.ticketType.create({
    data: {
      name: 'General Admission',
      price: 50.0,
      quantity: 100,
      eventId: event.id,
    },
  });

  console.log('Created ticket type:', ticketType);

  // Create a vendor profile
  const vendor = await prisma.vendor.create({
    data: {
      userId: user.id,
      businessName: 'Test Vendor',
      description: 'A test vendor',
      contactEmail: 'vendor@test.com',
      contactPhone: '+1234567890',
      website: 'https://vendor.test.com',
      category: 'Food',
      isVerified: true,
    },
  });

  console.log('Created vendor:', vendor);

  console.log('✅ Database populated with test data');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });