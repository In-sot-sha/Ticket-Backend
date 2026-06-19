import express, { Router } from 'express'
import userRoutes from './user'
import eventRoutes from './event'
import ticketRoutes from './ticket'
import vendorRoutes from './vendor'
import vendorTypeRoutes from './vendorType'
import userRoleRoutes from './userRole'
import organizationRoutes from './organization'
import organizationMemberRoutes from './organizationMember'
import paymentRoutes from './payment'
import gatePinRoutes from './gatePin'
import errorLogRoutes from './errorLog'
import adminRoutes from './admin'
import supportRoutes from './support'
import emailRoutes from './email'

const router: Router = express.Router()

router.use("/users", userRoutes);
router.use("/events", eventRoutes);
router.use("/tickets", ticketRoutes);
router.use("/vendors", vendorRoutes);
router.use("/vendor-types", vendorTypeRoutes);
router.use("/user-roles", userRoleRoutes);
router.use("/organizations", organizationRoutes);
router.use("/org-members", organizationMemberRoutes);
router.use("/payments", paymentRoutes);
router.use("/gate-pins", gatePinRoutes);
router.use("/errors", errorLogRoutes);
router.use("/admin", adminRoutes);
router.use("/support", supportRoutes);
router.use("/emails", emailRoutes);

export default router