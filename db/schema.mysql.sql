CREATE TABLE IF NOT EXISTS `DiscoveryRun` (
  `id` VARCHAR(36) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'RUNNING',
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt` DATETIME(3) NULL,
  `queryOrSource` TEXT NOT NULL,
  `candidatesDiscovered` INT NOT NULL DEFAULT 0,
  `recordsInserted` INT NOT NULL DEFAULT 0,
  `recordsSkipped` INT NOT NULL DEFAULT 0,
  `duplicatesSkipped` INT NOT NULL DEFAULT 0,
  `recordsUpdated` INT NOT NULL DEFAULT 0,
  `failures` INT NOT NULL DEFAULT 0,
  `errors` JSON NULL,
  PRIMARY KEY (`id`),
  KEY `discovery_run_started_idx` (`startedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `AppUser` (
  `id` VARCHAR(36) NOT NULL,
  `username` VARCHAR(30) NOT NULL,
  `usernameLower` VARCHAR(30) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `app_user_username_unique` (`usernameLower`),
  UNIQUE KEY `app_user_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `AppSession` (
  `tokenHash` CHAR(64) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tokenHash`),
  KEY `app_session_user_expiry_idx` (`userId`,`expiresAt`),
  CONSTRAINT `app_session_user_fk` FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `Opportunity` (
  `id` VARCHAR(36) NOT NULL,
  `canonicalUrl` VARCHAR(700) NOT NULL,
  `sourceUrl` TEXT NOT NULL,
  `sourceHost` VARCHAR(255) NOT NULL,
  `normalizedTitle` VARCHAR(500) NOT NULL,
  `title` VARCHAR(1000) NOT NULL,
  `institution` TEXT NULL,
  `country` VARCHAR(150) NULL,
  `degreeLevel` VARCHAR(150) NULL,
  `researchField` VARCHAR(255) NULL,
  `fundingType` TEXT NULL,
  `fundingEvidence` TEXT NULL,
  `fundingClassification` VARCHAR(30) NOT NULL DEFAULT 'NO_EVIDENCE',
  `eligibilityRequirements` TEXT NULL,
  `deadline` DATE NULL,
  `intakeTerm` VARCHAR(100) NULL,
  `intakeYear` INT NULL,
  `supervisorName` VARCHAR(255) NULL,
  `contactEmail` VARCHAR(255) NULL,
  `evidenceExcerpts` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `status` VARCHAR(30) NOT NULL DEFAULT 'UNCERTAIN',
  `discoveryDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastCheckedAt` DATETIME(3) NULL,
  `lastSuccessfulExtractionAt` DATETIME(3) NULL,
  `extractionStatus` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  `verificationStatus` VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED',
  `errorDetails` TEXT NULL,
  `isSaved` TINYINT(1) NOT NULL DEFAULT 0,
  `contentHash` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `extractionMethod` VARCHAR(100) NULL,
  `extractionError` TEXT NULL,
  `lastExtractionAt` DATETIME(3) NULL,
  `description` TEXT NULL,
  `department` VARCHAR(255) NULL,
  `labGroup` VARCHAR(255) NULL,
  `category` VARCHAR(60) NOT NULL DEFAULT 'OTHER',
  PRIMARY KEY (`id`),
  UNIQUE KEY `opportunity_canonical_unique` (`canonicalUrl`),
  KEY `opportunity_status_deadline_idx` (`status`,`deadline`),
  KEY `opportunity_degree_country_field_idx` (`degreeLevel`(64),`country`(64),`researchField`(64)),
  KEY `opportunity_funding_saved_idx` (`fundingClassification`,`isSaved`),
  KEY `opportunity_last_checked_idx` (`lastCheckedAt`),
  KEY `opportunity_title_host_idx` (`normalizedTitle`(180),`sourceHost`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `DiscoveryCandidate` (
  `id` VARCHAR(36) NOT NULL,
  `canonicalUrl` VARCHAR(700) NOT NULL,
  `sourceUrl` TEXT NOT NULL,
  `title` VARCHAR(1000) NOT NULL,
  `excerpt` TEXT NULL,
  `discoveredVia` VARCHAR(500) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'DISCOVERED',
  `lastDiscoveredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `runId` VARCHAR(36) NOT NULL,
  `opportunityId` VARCHAR(36) NULL,
  `errorDetails` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `candidate_canonical_unique` (`canonicalUrl`),
  KEY `candidate_status_discovered_idx` (`status`,`lastDiscoveredAt`),
  KEY `candidate_opportunity_idx` (`opportunityId`),
  CONSTRAINT `candidate_run_fk` FOREIGN KEY (`runId`) REFERENCES `DiscoveryRun` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `candidate_opportunity_fk` FOREIGN KEY (`opportunityId`) REFERENCES `Opportunity` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `OpportunitySource` (
  `id` VARCHAR(36) NOT NULL,
  `opportunityId` VARCHAR(36) NOT NULL,
  `sourceUrl` TEXT NOT NULL,
  `canonicalUrl` VARCHAR(500) NOT NULL,
  `sourceHost` VARCHAR(255) NOT NULL,
  `discoveredVia` VARCHAR(500) NOT NULL,
  `contentHash` VARCHAR(128) NULL,
  `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastCheckedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `opportunity_source_unique` (`opportunityId`,`canonicalUrl`),
  KEY `opportunity_source_canonical_idx` (`canonicalUrl`),
  CONSTRAINT `opportunity_source_opportunity_fk` FOREIGN KEY (`opportunityId`) REFERENCES `Opportunity` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `OpportunityChange` (
  `id` VARCHAR(36) NOT NULL,
  `opportunityId` VARCHAR(36) NOT NULL,
  `changes` JSON NOT NULL,
  `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `opportunity_change_history_idx` (`opportunityId`,`detectedAt`),
  CONSTRAINT `opportunity_change_opportunity_fk` FOREIGN KEY (`opportunityId`) REFERENCES `Opportunity` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `EmailDraft` (
  `id` VARCHAR(36) NOT NULL,
  `opportunityId` VARCHAR(36) NULL,
  `recipientName` VARCHAR(200) NULL,
  `recipientEmail` VARCHAR(320) NULL,
  `subject` VARCHAR(300) NULL,
  `body` TEXT NOT NULL,
  `gmailDraftId` VARCHAR(255) NULL,
  `savedToGmailAt` DATETIME(3) NULL,
  `userId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `email_draft_updated_idx` (`updatedAt`),
  CONSTRAINT `email_draft_opportunity_fk` FOREIGN KEY (`opportunityId`) REFERENCES `Opportunity` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `EmailSettings` (
  `id` VARCHAR(32) NOT NULL,
  `baseTemplate` MEDIUMTEXT NOT NULL,
  `adjustmentRules` TEXT NOT NULL,
  `applicantContext` TEXT NULL,
  `userId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_settings_user_unique` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `GmailConnection` (
  `id` VARCHAR(32) NOT NULL,
  `refreshTokenCiphertext` TEXT NOT NULL,
  `accountEmail` VARCHAR(320) NULL,
  `userId` VARCHAR(36) NULL,
  `connectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `gmail_connection_user_unique` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `UserSavedOpportunity` (
  `userId` VARCHAR(36) NOT NULL,
  `opportunityId` VARCHAR(36) NOT NULL,
  `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`,`opportunityId`),
  KEY `user_saved_opportunity_idx` (`opportunityId`),
  CONSTRAINT `user_saved_user_fk` FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_saved_opportunity_fk` FOREIGN KEY (`opportunityId`) REFERENCES `Opportunity` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `discovered_urls` (
  `id` VARCHAR(36) NOT NULL,
  `canonical_url` VARCHAR(700) NOT NULL,
  `source_url` TEXT NOT NULL,
  `title` VARCHAR(1000) NOT NULL,
  `excerpt` TEXT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `depth` TINYINT NOT NULL DEFAULT 0,
  `parent_url` VARCHAR(700) NULL,
  `source_references` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  `content_hash` VARCHAR(128) NULL,
  `opportunity_id` VARCHAR(36) NULL,
  `last_discovered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_crawled_at` DATETIME(3) NULL,
  `last_enriched_at` DATETIME(3) NULL,
  `crawl_error` VARCHAR(500) NULL,
  `enrichment_error` VARCHAR(500) NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `discovered_url_canonical_unique` (`canonical_url`),
  KEY `discovered_url_status_idx` (`status`,`last_discovered_at`),
  KEY `discovered_url_last_crawled_idx` (`last_crawled_at`),
  KEY `discovered_url_retry_idx` (`status`,`next_attempt_at`,`attempts`),
  CONSTRAINT `discovered_url_opportunity_fk` FOREIGN KEY (`opportunity_id`) REFERENCES `Opportunity` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `discovered_url_depth_check` CHECK (`depth` BETWEEN 0 AND 2),
  CONSTRAINT `discovered_url_status_check` CHECK (`status` IN ('PENDING','CRAWLING','CRAWLED','UNCHANGED','FAILED','DEFERRED','BLOCKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
