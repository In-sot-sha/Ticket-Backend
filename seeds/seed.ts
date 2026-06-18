import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password';

const prisma = new PrismaClient();

// List of event templates to generate rich, descriptive records
const eventTemplates = [
  {
    title: 'Afrobeats Live Fest',
    description: 'Experience the raw rhythm and energy of Afrobeats live in Kano with top chart-topping artists.',
    category: 'Music',
    imageUrl: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?q=80&w=800',
    location: 'Sani Abacha Stadium, Kofar Mata, Kano, Nigeria'
  },
  {
    title: 'Kano Jazz Nights',
    description: 'An elegant evening of smooth jazz, soul fusion, and sax solos featuring acclaimed instrumentalists.',
    category: 'Music',
    imageUrl: 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?q=80&w=800',
    location: 'Tahir Guest Palace, Kano, Nigeria'
  },
  {
    title: 'Durbar Cultural Soundwave',
    description: 'A celebration of Kano heritage with music, traditional singers, equestrian display, and visual arts.',
    category: 'Music',
    imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=800',
    location: 'Gidan Rumfa (Emir\'s Palace), Kano, Nigeria'
  },
  {
    title: 'AI & Web3 Developer Summit',
    description: 'Exploring the convergence of Artificial Intelligence, Machine Learning, and Blockchain technology.',
    category: 'Technology',
    imageUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800',
    location: 'BUK Convocation Arena, Kano, Nigeria'
  },
  {
    title: 'Tech Career Fair 2026',
    description: 'Accelerate your career. Connect with tech companies hiring software developers, PMs, and designers.',
    category: 'Technology',
    imageUrl: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?q=80&w=800',
    location: 'Mambayya House, Kano, Nigeria'
  },
  {
    title: 'Fintech Disruptors Forum',
    description: 'A gathering of payments, blockchain, and regulatory minds discussing cashless commerce in Africa.',
    category: 'Business',
    imageUrl: 'https://images.unsplash.com/photo-1591115765373-5207764f72e7?q=80&w=800',
    location: 'Bristol Palace Hotel, Kano, Nigeria'
  },
  {
    title: 'Street Food Carnival',
    description: 'Taste the best street foods. Features over 50 vendors, live grill stations, and acoustic music.',
    category: 'Food',
    imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?q=80&w=800',
    location: 'Kano Golf Club, Club Road, Kano, Nigeria'
  },
  {
    title: 'Jollof Rice Showdown',
    description: 'Celebrity Jollof rice showdown. Chefs compete, and the audience votes on the West African champion!',
    category: 'Food',
    imageUrl: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?q=80&w=800',
    location: 'Ado Bayero Mall Ground, Kano, Nigeria'
  },
  {
    title: 'Contemporary Art Showcase',
    description: 'A curated showcase of modern African paintings, sculptural masterpieces, and digital art.',
    category: 'Arts',
    imageUrl: 'https://images.unsplash.com/photo-1508962914676-134849a727f0?q=80&w=800',
    location: 'Gidan Makama Museum, Kano, Nigeria'
  },
  {
    title: 'Kano City Half Marathon',
    description: 'Join thousands of city runners. All ticket proceeds are donated to children community programs.',
    category: 'Sports',
    imageUrl: 'https://images.unsplash.com/photo-1502904585520-fa451459b48b?q=80&w=800',
    location: 'Kano Pillars Stadium, Sabon Gari, Kano, Nigeria'
  },
  {
    title: 'Morning Wellness Yoga',
    description: 'Unwind your mind and body. Therapeutic session covering mindful meditation and yoga.',
    category: 'Wellness',
    imageUrl: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=800',
    location: 'Kano Golf Club, Club Road, Kano, Nigeria'
  },
  {
    title: 'Startup Pitch Night',
    description: 'Early-stage founders present their companies to angel investors. Includes networking and drinks.',
    category: 'Business',
    imageUrl: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?q=80&w=800',
    location: 'Bristol Palace Hotel, Kano, Nigeria'
  }
];

const locations = [
  'Ado Bayero Mall, Kano, Nigeria',
  'Coronation Hall, Government House, Kano, Nigeria',
  'Sani Abacha Stadium, Kofar Mata, Kano, Nigeria',
  'Gidan Makama Museum, Kano, Nigeria',
  'Kano Pillars Stadium, Sabon Gari, Kano, Nigeria',
  'Tahir Guest Palace, Kano, Nigeria',
  'Bristol Palace Hotel, Kano, Nigeria',
  'BUK Convocation Arena, Kano, Nigeria',
  'Mambayya House, Kano, Nigeria',
  'Kano Golf Club, Club Road, Kano, Nigeria'
];

async function seedDatabase() {
  console.log('Clearing database tables...');
  
  try {
    // Delete in reverse order of creation to avoid foreign key constraint errors
    // Only delete tables that exist in the current schema
    try { await prisma.errorLog.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.gatePin.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.ticket.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.order.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.ticketType.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.vendorApplication.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.vendor.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.vendorType.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.payout.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.event.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.organizationMember.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.userOrganizationFollow.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.organization.deleteMany({}); } catch (e) { /* table may not exist */ }
    try { await prisma.user.deleteMany({}); } catch (e) { /* table may not exist */ }

    console.log('Seeding user profiles...');

    // Password helper
    const adminPassword = await hashPassword('admin123');
    const defaultPassword = await hashPassword('password123');

    // 1. Create ADMIN
    await prisma.user.create({
      data: {
        email: 'admin@partystorm.com',
        password: adminPassword,
        firstName: 'System',
        lastName: 'Admin',
        role: 'ADMIN',
        phone: '+2348000000001',
        isVerified: true
      }
    });

    // 2. Create ORGANIZER
    const organizerUser = await prisma.user.create({
      data: {
        email: 'organizer@example.com',
        password: defaultPassword,
        firstName: 'Jane',
        lastName: 'Smith',
        role: 'ORGANIZER',
        phone: '+2348011223344',
        isVerified: true
      }
    });

    // 3. Create VENDOR
    const vendorUser = await prisma.user.create({
      data: {
        email: 'vendor@example.com',
        password: defaultPassword,
        firstName: 'Mike',
        lastName: 'Johnson',
        role: 'VENDOR',
        phone: '+2348055667788',
        isVerified: true
      }
    });

    // 4. Create standard USER
    const regularUser = await prisma.user.create({
      data: {
        email: 'user@example.com',
        password: defaultPassword,
        firstName: 'John',
        lastName: 'Doe',
        role: 'USER',
        phone: '+2348099887766',
        isVerified: true
      }
    });

    console.log('Seeding organizations...');

    // Create central seed Organization
    const organization = await prisma.organization.create({
      data: {
        name: 'Kano Event Hub',
        description: 'Empowering local community experiences through festivals, corporate conferences, and concerts in Kano.',
        website: 'https://kanoeventhub.com',
        logo: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?q=80&w=200',
        ownerId: organizerUser.id,
        isVerified: true
      }
    });

    // Add owner as member
    await prisma.organizationMember.create({
      data: {
        userId: organizerUser.id,
        organizationId: organization.id,
        role: 'owner'
      }
    });

    // Create Vendor profile for the vendor user
    await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        businessName: 'Mike Delights & Drinks',
        description: 'Professional catering services, juices, mocktails, and finger foods.',
        contactEmail: 'mike@delights.com',
        contactPhone: '+2348055667788',
        category: 'Food',
        isVerified: true
      }
    });

    console.log('Generating 50 events...');

    // Generate 50 events in a loop
    for (let i = 1; i <= 50; i++) {
      // Pick template
      const template = eventTemplates[(i - 1) % eventTemplates.length];
      if (!template) continue;
      
      // Determine date timeline (some past, some current, mostly future)
      let startDate = new Date();
      let endDate = new Date();

      if (i <= 8) {
        // Past events (e.g. 1 to 6 months ago)
        startDate.setMonth(startDate.getMonth() - (i % 6 + 1));
        startDate.setDate(startDate.getDate() - (i % 15));
        endDate.setTime(startDate.getTime() + (3 * 60 * 60 * 1000)); // 3 hours duration
      } else if (i === 9 || i === 10) {
        // Happening today / current
        startDate.setHours(9, 0, 0, 0);
        endDate.setHours(18, 0, 0, 0);
      } else {
        // Future upcoming events (1 week to 8 months in future)
        startDate.setMonth(startDate.getMonth() + Math.ceil(i / 6));
        startDate.setDate(startDate.getDate() + (i % 20 + 2));
        startDate.setHours(10, 0, 0, 0);
        endDate.setTime(startDate.getTime() + (4 * 60 * 60 * 1000)); // 4 hours duration
      }

      // Determine location types: physical, online, hybrid
      let locationType = 'physical';
      let locationVal: string | null = template.location;
      let onlineUrlVal: string | null = null;

      if (i % 5 === 0) {
        locationType = 'online';
        locationVal = null;
        onlineUrlVal = 'https://zoom.us/j/kanoeventhub-' + i;
      } else if (i % 6 === 0) {
        locationType = 'hybrid';
        locationVal = locations[i % locations.length] || 'Ado Bayero Mall, Kano, Nigeria';
        onlineUrlVal = 'https://youtube.com/live/partystorm-live-' + i;
      } else {
        locationVal = locations[i % locations.length] || 'Ado Bayero Mall, Kano, Nigeria';
      }

      // Determine pricing: every 4th event is FREE (price=0/null), others are PAID
      const isFree = (i % 4 === 0);
      const eventPrice = isFree ? 0 : (2000 + (i % 5) * 3000); // base prices: 2000, 5000, 8000, 11000, 14000

      // Create Event
      const event = await prisma.event.create({
        data: {
          title: `${template.title} (Edition ${Math.ceil(i / 10)})`,
          description: `${template.description} Edition ${Math.ceil(i / 10)} of our annual flagship meeting.`,
          startDate,
          endDate,
          locationType,
          location: locationVal,
          onlineUrl: onlineUrlVal,
          price: isFree ? 0 : eventPrice,
          capacity: 100 + (i * 20),
          imageUrl: template.imageUrl,
          category: template.category,
          isPublished: true,
          organizationId: organization.id,
          allowVendors: i % 3 === 0, // allow vendors on some events
          vendorDeadline: i % 3 === 0 ? new Date(startDate.getTime() - (7 * 24 * 60 * 60 * 1000)) : null,
          gateTicketing: i % 2 === 0
        }
      });

      // Populate TicketTypes
      if (isFree) {
        // Free ticket type
        await prisma.ticketType.create({
          data: {
            name: 'Free Admission',
            price: 0,
            quantity: 150,
            eventId: event.id
          }
        });
      } else {
        // Multiple ticket categories
        await prisma.ticketType.create({
          data: {
            name: 'Student Pass',
            price: Math.round(eventPrice * 0.5),
            quantity: 100,
            eventId: event.id
          }
        });

        await prisma.ticketType.create({
          data: {
            name: 'Regular Ticket',
            price: eventPrice,
            quantity: 200,
            eventId: event.id
          }
        });

        await prisma.ticketType.create({
          data: {
            name: 'VIP Experience',
            price: eventPrice * 3,
            quantity: 50,
            eventId: event.id
          }
        });
      }

      // Seeding vendor types if vendors are allowed
      if (event.allowVendors) {
        await prisma.vendorType.create({
          data: {
            name: 'Standard Stall',
            fee: 15000,
            maxVendors: 10,
            eventId: event.id
          }
        });
        
        await prisma.vendorType.create({
          data: {
            name: 'Premium Food Booth',
            fee: 35000,
            maxVendors: 5,
            eventId: event.id
          }
        });
      }

      // Seed a few ticket purchases for past and current events
      if (i <= 10) {
        const ticketTypes = await prisma.ticketType.findMany({ where: { eventId: event.id } });
        if (ticketTypes.length > 0) {
          const selectedType = ticketTypes[i % ticketTypes.length];
          if (selectedType) {
            // Create an order first
            const order = await prisma.order.create({
              data: {
                userId: regularUser.id,
                eventId: event.id,
                totalAmount: selectedType.price,
                status: 'PAID',
                purchaseType: 'ONLINE'
              }
            });
            // Create ticket purchase trace
            await prisma.ticket.create({
              data: {
                eventId: event.id,
                userId: regularUser.id,
                ticketTypeId: selectedType.id,
                orderId: order.id,
                qrCode: `partystorm_ticket_seed_${event.id}_${selectedType.id}_${Date.now()}`,
                status: i <= 8 ? 'USED' : 'VALID',
                purchaseType: 'ONLINE'
              }
            });
          }
        }
      }
    }

    console.log('Database seeded with 50 events, users, and ticket structures successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedDatabase();
