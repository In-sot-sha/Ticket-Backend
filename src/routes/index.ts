import express, { Router } from 'express'
import userRoutes from './user'
import eventRoutes from './event'
import ticketRoutes from './ticket'
import vendorRoutes from './vendor'
import userRoleRoutes from './userRole'

const router: Router = express.Router()

router.use("/users", userRoutes);
router.use("/events", eventRoutes);
router.use("/tickets", ticketRoutes);
router.use("/vendors", vendorRoutes);
router.use("/user-roles", userRoleRoutes);


export default router