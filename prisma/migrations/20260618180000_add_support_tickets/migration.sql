-- CreateTable
CREATE TABLE `SupportTicket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `contactName` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `category` ENUM('GENERAL', 'BILLING', 'TICKETS', 'HOSTING', 'TECHNICAL', 'OTHER') NOT NULL DEFAULT 'GENERAL',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SupportTicket_status_idx`(`status`),
    INDEX `SupportTicket_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportTicketMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `authorId` INTEGER NULL,
    `authorRole` VARCHAR(191) NOT NULL DEFAULT 'USER',
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupportTicketMessage_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SupportTicket` ADD CONSTRAINT `SupportTicket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportTicketMessage` ADD CONSTRAINT `SupportTicketMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `SupportTicket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportTicketMessage` ADD CONSTRAINT `SupportTicketMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
