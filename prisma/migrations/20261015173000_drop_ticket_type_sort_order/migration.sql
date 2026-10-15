-- Keep FK coverage on eventId before dropping the composite index
CREATE INDEX `TicketType_eventId_idx` ON `TicketType`(`eventId`);

-- DropIndex
DROP INDEX `TicketType_eventId_sortOrder_idx` ON `TicketType`;

-- AlterTable
ALTER TABLE `TicketType` DROP COLUMN `sortOrder`;
