-- AlterTable
ALTER TABLE `Event` ADD COLUMN `amenities` TEXT NULL,
    ADD COLUMN `highlights` TEXT NULL;

-- AlterTable
ALTER TABLE `TicketType` ADD COLUMN `accentColor` VARCHAR(191) NULL,
    ADD COLUMN `badgeText` VARCHAR(191) NULL,
    ADD COLUMN `ticketHeadline` VARCHAR(191) NULL,
    ADD COLUMN `ticketStyle` VARCHAR(191) NOT NULL DEFAULT 'rose',
    ADD COLUMN `venueLabel` VARCHAR(191) NULL;
