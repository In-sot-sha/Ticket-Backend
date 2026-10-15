-- AlterTable
ALTER TABLE `TicketType` ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

-- Backfill: preserve current id order within each event
UPDATE `TicketType` t
JOIN (
  SELECT
    `id`,
    ROW_NUMBER() OVER (PARTITION BY `eventId` ORDER BY `id` ASC) - 1 AS `rn`
  FROM `TicketType`
) ranked ON t.`id` = ranked.`id`
SET t.`sortOrder` = ranked.`rn`;

-- CreateIndex
CREATE INDEX `TicketType_eventId_sortOrder_idx` ON `TicketType`(`eventId`, `sortOrder`);
