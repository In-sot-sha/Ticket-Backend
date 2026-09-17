-- Per-day vs all-event ticket types, and one check-in per calendar day.
ALTER TABLE `TicketType` ADD COLUMN `validOn` DATETIME(3) NULL;

CREATE TABLE `TicketCheckIn` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ticketId` INTEGER NOT NULL,
  `eventDay` VARCHAR(191) NOT NULL,
  `scannedBy` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TicketCheckIn_ticketId_eventDay_key`(`ticketId`, `eventDay`),
  INDEX `TicketCheckIn_eventDay_idx`(`eventDay`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TicketCheckIn` ADD CONSTRAINT `TicketCheckIn_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
