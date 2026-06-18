-- AlterTable
ALTER TABLE `Organization` ADD COLUMN `rejectionReason` TEXT NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL;
