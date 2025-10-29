import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password';

const prisma = new PrismaClient();

async function seedDatabase() {
  console.log('Seeding database...');

  try {
    // Clear existing data (optional, for testing)
    await prisma.vendor.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.user.deleteMany({});

    // Create sample users with different roles
    const user = await prisma.user.create({
      data: {
        email: 'user@example.com',
        password: await hashPassword('password123'),
        firstName: 'John',
        lastName: 'Doe',
        role: 'USER',
        phone: '+2348012345678',
        isVerified: true,
      }
    });

    const organizer = await prisma.user.create({
      data: {
        email: 'organizer@example.com',
        password: await hashPassword('password123'),
        firstName: 'Jane',
        lastName: 'Smith',
        role: 'ORGANIZER',
        phone: '+2348087654321',
        isVerified: true,
        isOrganizerVerified: true,
        organizerBusinessName: 'Event Pro Ltd',
        organizerDescription: 'Professional event management company',
        organizerContactInfo: 'contact@eventpro.com'
      }
    });

    const vendor = await prisma.user.create({
      data: {
        email: 'vendor@example.com',
        password: await hashPassword('password123'),
        firstName: 'Mike',
        lastName: 'Johnson',
        role: 'VENDOR',
        phone: '+2348011223344',
        isVerified: true,
      }
    });



    // Create sample events
    const event1 = await prisma.event.create({
      data: {
        title: 'Tech Conference 2023',
        description: 'Annual technology conference featuring industry leaders',
        startDate: new Date('2023-12-15'),
        endDate: new Date('2023-12-16'),
        location: 'Lagos, Nigeria',
        price: 50000,
        capacity: 500,
        isPublished: true,
        organizerId: organizer.id,
        allowVendors: true,
        stallType: 'Technology',
        stallFee: 50000,
        maxVendors: 20,
        vendorDeadline: new Date('2023-12-01'),
        gateTicketing: true
      }
    });

    const event2 = await prisma.event.create({
      data: {
        title: 'Music Festival',
        description: 'Annual music festival featuring top artists',
        startDate: new Date('2024-01-20'),
        endDate: new Date('2024-01-21'),
        location: 'Abuja, Nigeria',
        price: 30000,
        capacity: 1000,
        isPublished: true,
        organizerId: organizer.id,
        allowVendors: true,
        stallType: 'Food & Drinks',
        stallFee: 30000,
        maxVendors: 30,
        vendorDeadline: new Date('2024-01-05'),
        gateTicketing: true
      }
    });

    // Create ticket types for events
    await prisma.ticketType.create({
      data: {
        name: 'General Admission',
        price: 10000,
        quantity: 200,
        eventId: event1.id
      }
    });

    await prisma.ticketType.create({
      data: {
        name: 'VIP',
        price: 50000,
        quantity: 50,
        eventId: event1.id
      }
    });

    await prisma.ticketType.create({
      data: {
        name: 'Early Bird',
        price: 7000,
        quantity: 100,
        eventId: event2.id
      }
    });

    await prisma.ticketType.create({
      data: {
        name: 'Premium',
        price: 25000,
        quantity: 80,
        eventId: event2.id
      }
    });

    // Create sample tickets
    const ticketType1 = await prisma.ticketType.findFirst({
      where: { eventId: event1.id, name: 'General Admission' }
    });

    if (ticketType1) {
      await prisma.ticket.create({
        data: {
          eventId: event1.id,
          userId: user.id,
          ticketTypeId: ticketType1.id,
          qrCode: 'qr_code_1',
          status: 'VALID',
          purchaseType: 'ONLINE'
        }
      });

      await prisma.ticket.create({
        data: {
          eventId: event1.id,
          userId: user.id,
          ticketTypeId: ticketType1.id,
          qrCode: 'qr_code_2',
          status: 'USED',
          purchaseType: 'GATE'
        }
      });
    }

    // Create sample vendor applications
    await prisma.vendor.create({
      data: {
        userId: vendor.id,
        eventId: event1.id,
        name: 'Mike Johnson',
        businessName: 'Tech Gadgets Ltd',
        description: 'Selling the latest tech gadgets and accessories',
        contactEmail: 'contact@techgadgets.com',
        contactPhone: '+2348012345699',
        isApproved: true,
        isPaid: true,
        paymentAmount: 50000
      }
    });

    await prisma.vendor.create({
      data: {
        userId: vendor.id,
        eventId: event2.id,
        name: 'Mike Johnson',
        businessName: 'Food Delights',
        description: 'Delicious local cuisine',
        contactEmail: 'info@fooddelights.com',
        contactPhone: '+2348012345700',
        isApproved: false,
        isPaid: true,
        paymentAmount: 30000
      }
    });

    console.log('Database seeded successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedDatabase();