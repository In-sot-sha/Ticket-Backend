/*
  Warnings:

  - You are about to drop the column `isOrganizerVerified` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `organizerBusinessName` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `organizerContactInfo` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `organizerDescription` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `EventTag` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EventTagOnEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TicketPurchase` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[authProviderId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `EventTagOnEvent` DROP FOREIGN KEY `EventTagOnEvent_eventId_fkey`;

-- DropForeignKey
ALTER TABLE `EventTagOnEvent` DROP FOREIGN KEY `EventTagOnEvent_tagId_fkey`;

-- DropForeignKey
ALTER TABLE `TicketPurchase` DROP FOREIGN KEY `TicketPurchase_eventId_fkey`;

-- DropForeignKey
ALTER TABLE `TicketPurchase` DROP FOREIGN KEY `TicketPurchase_ticketTypeId_fkey`;

-- DropForeignKey
ALTER TABLE `TicketPurchase` DROP FOREIGN KEY `TicketPurchase_userId_fkey`;

-- AlterTable
ALTER TABLE `Event` ADD COLUMN `tags` JSON NULL;

-- AlterTable
ALTER TABLE `Organization` ADD COLUMN `businessAddress` TEXT NULL,
    ADD COLUMN `payoutAccountName` VARCHAR(191) NULL,
    ADD COLUMN `payoutAccountNumber` VARCHAR(191) NULL,
    ADD COLUMN `payoutBankName` VARCHAR(191) NULL,
    ADD COLUMN `payoutSchedule` VARCHAR(191) NULL DEFAULT 'AFTER_EVENT',
    ADD COLUMN `socials` VARCHAR(191) NULL,
    ADD COLUMN `taxId` VARCHAR(191) NULL,
    ADD COLUMN `vatNumber` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Ticket` ADD COLUMN `orderId` INTEGER NULL;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `isOrganizerVerified`,
    DROP COLUMN `organizerBusinessName`,
    DROP COLUMN `organizerContactInfo`,
    DROP COLUMN `organizerDescription`,
    ADD COLUMN `authProvider` VARCHAR(191) NOT NULL DEFAULT 'local',
    ADD COLUMN `authProviderId` VARCHAR(191) NULL,
    MODIFY `password` VARCHAR(191) NULL;

-- DropTable
DROP TABLE `EventTag`;

-- DropTable
DROP TABLE `EventTagOnEvent`;

-- DropTable
DROP TABLE `TicketPurchase`;

-- CreateTable
CREATE TABLE `Order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `eventId` INTEGER NOT NULL,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `platformFee` DOUBLE NOT NULL DEFAULT 0,
    `processingFee` DOUBLE NOT NULL DEFAULT 0,
    `netAmount` DOUBLE NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PAID', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `purchaseType` ENUM('ONLINE', 'GATE') NOT NULL DEFAULT 'ONLINE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payout` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `organizationId` INTEGER NOT NULL,
    `amount` DOUBLE NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `reference` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_authProviderId_key` ON `User`(`authProviderId`);

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payout` ADD CONSTRAINT `Payout_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
