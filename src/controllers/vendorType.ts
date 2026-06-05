import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';

// Get all vendor types for an event
export const getVendorTypesForEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    
    // Verify that the user has permission to access this event
    const event = await prisma.event.findFirst({
      where: {
        id: Number(eventId),
        organization: {
          OR: [
            { ownerId: req.userId! },
            { members: {
                some: {
                  userId: req.userId!
                }
              }
            }
          ]
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found or you do not have permission to access it' });
    }

    const vendorTypes = await prisma.vendorType.findMany({
      where: { eventId: Number(eventId) },
      include: {
        applications: {
          include: {
            vendor: {
              select: {
                businessName: true,
                description: true
              }
            }
          }
        }
      }
    });

    return res.json(vendorTypes);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Create a new vendor type for an event
export const createVendorType = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const { name, fee, maxVendors } = req.body;

    // Verify that the user has permission to modify this event
    const event = await prisma.event.findFirst({
      where: {
        id: Number(eventId),
        organization: {
          OR: [
            { ownerId: req.userId! },
            { members: {
                some: {
                  userId: req.userId!
                }
              }
            }
          ]
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found or you do not have permission to modify it' });
    }

    // Create the new vendor type
    const vendorType = await prisma.vendorType.create({
      data: {
        name,
        fee: fee ? parseFloat(fee) : null,
        maxVendors: maxVendors ? parseInt(maxVendors) : null,
        eventId: Number(eventId)
      }
    });

    return res.status(201).json({
      message: 'Vendor type created successfully',
      vendorType
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Update a vendor type
export const updateVendorType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, fee, maxVendors } = req.body;

    // Find the vendor type and ensure user has permission to modify it
    const vendorType = await prisma.vendorType.findFirst({
      where: {
        id: Number(id),
        event: {
          organization: {
            OR: [
              { ownerId: req.userId! },
              { members: {
                  some: {
                    userId: req.userId!
                  }
                }
              }
            ]
          }
        }
      }
    });

    if (!vendorType) {
      return res.status(404).json({ message: 'Vendor type not found or you do not have permission to modify it' });
    }

    // Update the vendor type
    const updatedVendorType = await prisma.vendorType.update({
      where: { id: Number(id) },
      data: {
        name: name || vendorType.name,
        fee: fee !== undefined ? parseFloat(fee) : vendorType.fee,
        maxVendors: maxVendors !== undefined ? parseInt(maxVendors) : vendorType.maxVendors
      }
    });

    return res.json({
      message: 'Vendor type updated successfully',
      vendorType: updatedVendorType
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Delete a vendor type
export const deleteVendorType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Find the vendor type and ensure user has permission to delete it
    const vendorType = await prisma.vendorType.findFirst({
      where: {
        id: Number(id),
        event: {
          organization: {
            OR: [
              { ownerId: req.userId! },
              { members: {
                  some: {
                    userId: req.userId!
                  }
                }
              }
            ]
          }
        }
      }
    });

    if (!vendorType) {
      return res.status(404).json({ message: 'Vendor type not found or you do not have permission to delete it' });
    }

    // Delete any related vendor applications first (due to foreign key constraints)
    await prisma.vendorApplication.deleteMany({
      where: { vendorTypeId: Number(id) }
    });

    // Delete the vendor type
    await prisma.vendorType.delete({
      where: { id: Number(id) }
    });

    return res.json({ message: 'Vendor type deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};