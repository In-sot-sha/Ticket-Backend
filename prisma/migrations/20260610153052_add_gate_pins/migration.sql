-- CreateTable
CREATE TABLE `GatePin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pin` VARCHAR(191) NOT NULL,
    `staffName` VARCHAR(191) NOT NULL,
    `organizationId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GatePin_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `GatePin_pin_organizationId_key`(`pin`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GatePin` ADD CONSTRAINT `GatePin_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GatePin` ADD CONSTRAINT `GatePin_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
