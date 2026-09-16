-- WhatsApp delivery settings (no secrets) and delivery log.
-- Apply against MySQL only. Do not run this file against Postgres.

CREATE TABLE `WhatsAppConfig` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `sendTickets` BOOLEAN NOT NULL DEFAULT true,
  `sendOtp` BOOLEAN NOT NULL DEFAULT true,
  `ticketTemplate` VARCHAR(191) NOT NULL DEFAULT 'partystorm_ticket_confirm',
  `otpTemplate` VARCHAR(191) NOT NULL DEFAULT 'partystorm_otp',
  `templateLanguage` VARCHAR(191) NOT NULL DEFAULT 'en',
  `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
  `ticketPrice` DOUBLE NOT NULL DEFAULT 10,
  `otpPrice` DOUBLE NOT NULL DEFAULT 10,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WhatsAppMessage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `kind` ENUM('TICKET', 'OTP') NOT NULL,
  `toPhone` VARCHAR(191) NOT NULL,
  `templateName` VARCHAR(191) NOT NULL,
  `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED') NOT NULL DEFAULT 'QUEUED',
  `wamid` VARCHAR(191) NULL,
  `orderId` INTEGER NULL,
  `ticketId` INTEGER NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `price` DOUBLE NOT NULL DEFAULT 0,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WhatsAppMessage_wamid_key`(`wamid`),
  INDEX `WhatsAppMessage_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `WhatsAppMessage_orderId_idx`(`orderId`),
  INDEX `WhatsAppMessage_ticketId_idx`(`ticketId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
