-- DropForeignKey
ALTER TABLE `Event` DROP FOREIGN KEY `Event_organizationId_fkey`;

-- AlterTable
ALTER TABLE `Event` MODIFY `organizationId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
