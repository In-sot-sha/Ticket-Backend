import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

// Create a new organization
export const createOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, website } = req.body;

    // Check if organization with this name already exists for this user
    const existingOrg = await prisma.organization.findFirst({
      where: {
        ownerId: req.userId!,
        name
      }
    });

    if (existingOrg) {
      return res.status(400).json({ message: 'An organization with this name already exists' });
    }

    // Create organization
    const organization = await prisma.organization.create({
      data: {
        name,
        description,
        website,
        ownerId: req.userId!,
        isVerified: false // Pending verification
      }
    });

    // Automatically add the owner as a member with admin role
    await prisma.organizationMember.create({
      data: {
        userId: req.userId!,
        organizationId: organization.id,
        role: 'admin'
      }
    });

    return res.status(201).json({
      message: 'Organization created successfully',
      organization
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during organization creation' });
  }
};

// Get organizations for the current user (owned and member of)
export const getUserOrganizations = async (req: AuthRequest, res: Response) => {
  try {
    const organizations = await prisma.organization.findMany({
      where: {
        OR: [
          { ownerId: req.userId! },
          { members: {
              some: {
                userId: req.userId!
              }
            }
          }
        ]
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        members: {
          select: {
            id: true,
            role: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            events: true
          }
        }
      }
    });

    return res.json(organizations);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get organization by ID
export const getOrganizationById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        members: {
          select: {
            id: true,
            role: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        },
        events: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            isPublished: true
          }
        },
        _count: {
          select: {
            members: true,
            events: true,
            followers: true
          }
        }
      }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Check if user has permission to view this organization
    const isOwner = organization.ownerId === req.userId;
    const isMember = organization.members.some(member => member.user.id === req.userId);
    
    if (!isOwner && !isMember) {
      return res.status(403).json({ message: 'You do not have permission to view this organization' });
    }

    return res.json(organization);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Update organization
export const updateOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, website } = req.body;

    // Check if organization exists and user has permission to update it
    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Only owner can update organization
    if (organization.ownerId !== req.userId) {
      return res.status(403).json({ message: 'You do not have permission to update this organization' });
    }

    // Check if another organization with this name exists for this user
    const existingOrg = await prisma.organization.findFirst({
      where: {
        ownerId: req.userId!,
        name,
        NOT: {
          id: Number(id)
        }
      }
    });

    if (existingOrg) {
      return res.status(400).json({ message: 'An organization with this name already exists' });
    }

    // Update organization
    const updatedOrganization = await prisma.organization.update({
      where: { id: Number(id) },
      data: {
        name,
        description,
        website
      }
    });

    return res.json({
      message: 'Organization updated successfully',
      organization: updatedOrganization
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Delete organization
export const deleteOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Only owner can delete organization
    if (organization.ownerId !== req.userId) {
      return res.status(403).json({ message: 'You do not have permission to delete this organization' });
    }

    // Check if organization has events (can't delete if it does)
    const eventCount = await prisma.event.count({
      where: {
        organizationId: Number(id)
      }
    });

    if (eventCount > 0) {
      return res.status(400).json({ message: 'Cannot delete organization with existing events' });
    }

    // Delete organization members first
    await prisma.organizationMember.deleteMany({
      where: {
        organizationId: Number(id)
      }
    });

    // Delete organization followers
    await prisma.userOrganizationFollow.deleteMany({
      where: {
        organizationId: Number(id)
      }
    });

    // Finally delete the organization
    await prisma.organization.delete({
      where: { id: Number(id) }
    });

    return res.json({ message: 'Organization deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Add member to organization
export const addOrganizationMember = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, role = 'member' } = req.body;

    // Check if organization exists and user has permission to add members
    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Only owner or admins can add members
    const currentUserMembership = await prisma.organizationMember.findFirst({
      where: {
        organizationId: Number(id),
        userId: req.userId!,
        role: 'admin'
      }
    });

    const isOwner = organization.ownerId === req.userId;
    const isAdmin = currentUserMembership !== null;
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'You do not have permission to add members to this organization' });
    }

    // Check if user is already a member
    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: Number(id),
        userId: Number(userId)
      }
    });

    if (existingMember) {
      return res.status(400).json({ message: 'User is already a member of this organization' });
    }

    // Add member to organization
    const member = await prisma.organizationMember.create({
      data: {
        userId: Number(userId),
        organizationId: Number(id),
        role
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    return res.status(201).json({
      message: 'Member added successfully',
      member
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Remove member from organization
export const removeOrganizationMember = async (req: AuthRequest, res: Response) => {
  try {
    const { id, memberId } = req.params;

    // Check if organization exists and user has permission to remove members
    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Only owner or admins can remove members
    const currentUserMembership = await prisma.organizationMember.findFirst({
      where: {
        organizationId: Number(id),
        userId: req.userId!,
        role: 'admin'
      }
    });

    const isOwner = organization.ownerId === req.userId;
    const isAdmin = currentUserMembership !== null;
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'You do not have permission to remove members from this organization' });
    }

    // Cannot remove owner
    if (Number(memberId) === organization.ownerId) {
      return res.status(400).json({ message: 'Cannot remove the organization owner' });
    }

    // Check if member exists
    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: Number(id),
        userId: Number(memberId)
      }
    });

    if (!existingMember) {
      return res.status(404).json({ message: 'Member not found in this organization' });
    }

    // Remove member from organization
    await prisma.organizationMember.delete({
      where: {
        userId_organizationId: {
          userId: Number(memberId),
          organizationId: Number(id)
        }
      }
    });

    return res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Follow organization
export const followOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Check if user is already following
    const existingFollow = await prisma.userOrganizationFollow.findFirst({
      where: {
        userId: req.userId!,
        organizationId: Number(id)
      }
    });

    if (existingFollow) {
      return res.status(400).json({ message: 'You are already following this organization' });
    }

    // Follow organization
    const follow = await prisma.userOrganizationFollow.create({
      data: {
        userId: req.userId!,
        organizationId: Number(id)
      }
    });

    return res.status(201).json({
      message: 'Successfully followed organization',
      follow
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Unfollow organization
export const unfollowOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Check if user is following
    const existingFollow = await prisma.userOrganizationFollow.findFirst({
      where: {
        userId: req.userId!,
        organizationId: Number(id)
      }
    });

    if (!existingFollow) {
      return res.status(400).json({ message: 'You are not following this organization' });
    }

    // Unfollow organization
    await prisma.userOrganizationFollow.delete({
      where: {
        userId_organizationId: {
          userId: req.userId!,
          organizationId: Number(id)
        }
      }
    });

    return res.json({ message: 'Successfully unfollowed organization' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get organization followers
export const getOrganizationFollowers = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(id) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Get followers
    const followers = await prisma.userOrganizationFollow.findMany({
      where: {
        organizationId: Number(id)
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        followedAt: 'desc'
      }
    });

    return res.json(followers);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};