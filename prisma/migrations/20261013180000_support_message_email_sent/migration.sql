-- AlterTable
ALTER TABLE `SupportTicketMessage` ADD COLUMN `emailSent` BOOLEAN NULL;
ALTER TABLE `SupportTicketMessage` ADD COLUMN `emailSentAt` DATETIME(3) NULL;
