/*
  Warnings:

  - You are about to drop the column `maxVendors` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `stallFee` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `stallType` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `vendorType` on the `VendorApplication` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Event` DROP COLUMN `maxVendors`,
    DROP COLUMN `stallFee`,
    DROP COLUMN `stallType`;

-- AlterTable
ALTER TABLE `VendorApplication` DROP COLUMN `vendorType`,
    ADD COLUMN `vendorTypeId` INTEGER NULL;

-- CreateTable
CREATE TABLE `VendorType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `fee` DOUBLE NULL,
    `maxVendors` INTEGER NULL,
    `eventId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VendorApplication` ADD CONSTRAINT `VendorApplication_vendorTypeId_fkey` FOREIGN KEY (`vendorTypeId`) REFERENCES `VendorType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorType` ADD CONSTRAINT `VendorType_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
