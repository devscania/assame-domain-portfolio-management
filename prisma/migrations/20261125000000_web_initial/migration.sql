-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "PlatformAdminAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuspiciousActivity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raisedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "SuspiciousActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'contact',
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "verificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthSignupPending" (
    "userId" TEXT NOT NULL,
    "recovered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthSignupPending_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SecurityNotice" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SecurityNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomeNotice" (
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "WelcomeNotice_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "AccountLoginSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "oauthSignupPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountLoginSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspaceOwnerId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "pricePublishingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "providerActionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "customRoleId" TEXT,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceCustomRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseRole" "Role" NOT NULL,
    "allowProviderWrites" BOOLEAN NOT NULL DEFAULT false,
    "allowDomainDeletion" BOOLEAN NOT NULL DEFAULT true,
    "allowFinanceRecords" BOOLEAN NOT NULL DEFAULT true,
    "allowSync" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WorkspaceCustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "lastSyncAt" TIMESTAMP(3),
    "syncEveryHours" INTEGER NOT NULL DEFAULT 24,
    "lockedUntil" TIMESTAMP(3),
    "lockOwner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedCredential" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncryptedCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSyncState" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "cursor" TEXT,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "ProviderSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "lastCompletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "kind" TEXT NOT NULL DEFAULT 'read',
    "requestedBy" TEXT,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderJobReview" (
    "jobId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderJobReview_pkey" PRIMARY KEY ("jobId","membershipId")
);

-- CreateTable
CREATE TABLE "SyncJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,

    CONSTRAINT "SyncJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationError" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unicodeName" TEXT NOT NULL,
    "tld" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "acquisitionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "acquiredAt" TIMESTAMP(3),
    "askingPrice" DECIMAL(18,2),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainRegistration" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "registrar" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "renewalCost" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "autoRenew" BOOLEAN,
    "nameservers" TEXT[],
    "dns" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "DomainRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainListing" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "marketplace" TEXT NOT NULL,
    "externalId" TEXT,
    "binPrice" DECIMAL(18,2),
    "minOffer" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'listed',
    "lto" JSONB,
    "analytics" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "verifiedAt" TIMESTAMP(3),
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "statusCheckedAt" TIMESTAMP(3),

    CONSTRAINT "DomainListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainPriceHistory" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "previousPrice" DECIMAL(18,2),
    "price" DECIMAL(18,2),
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "DomainTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainTagAssignment" (
    "domainId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "DomainTagAssignment_pkey" PRIMARY KEY ("domainId","tagId")
);

-- CreateTable
CREATE TABLE "DomainNote" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainExpense" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "DomainExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainRenewal" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "syncJobId" TEXT,

    CONSTRAINT "ProviderChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainVerification" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainSale" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'outright',
    "status" TEXT NOT NULL DEFAULT 'signed',
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "DomainSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalePayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "commissionWithheld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT NOT NULL,

    CONSTRAINT "SalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleInstallment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAdjustment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceActivityRead" (
    "activityId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceActivityRead_pkey" PRIMARY KEY ("activityId","membershipId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","membershipId")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "notifications" BOOLEAN NOT NULL DEFAULT true,
    "renewalEmails" BOOLEAN NOT NULL DEFAULT false,
    "activityEmails" BOOLEAN NOT NULL DEFAULT false,
    "activityBulkEmails" BOOLEAN NOT NULL DEFAULT true,
    "activityPriceEmails" BOOLEAN NOT NULL DEFAULT true,
    "activitySyncEmails" BOOLEAN NOT NULL DEFAULT true,
    "savedFilters" JSONB,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityNotice" (
    "eventId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "recipientId" TEXT,
    "title" TEXT,
    "message" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ActivityNotice_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "RenewalReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "RenewalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthThrottle" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SpaceshipRequestBudget" (
    "key" TEXT NOT NULL,
    "stamps" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceshipRequestBudget_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProviderSaleObservation" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "commissionAmount" DECIMAL(18,2),
    "installmentAmount" DECIMAL(18,2),
    "nextInstallmentAt" TIMESTAMP(3),
    "previousInstallmentAt" TIMESTAMP(3),
    "disbursedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3),
    "installments" INTEGER,
    "installmentsPaid" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderSaleObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAnalytics" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL,
    "leads" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPriceChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "oldPrice" DECIMAL(18,2),
    "newPrice" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "remoteStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "syncJobId" TEXT,
    "notificationGroup" TEXT,

    CONSTRAINT "ListingPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRegistrationJob" (
    "organizationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "cursor" TEXT NOT NULL DEFAULT '',
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "unavailable" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PublicRegistrationJob_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE INDEX "PlatformAdminAudit_createdAt_idx" ON "PlatformAdminAudit"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAdminAudit_actorId_createdAt_idx" ON "PlatformAdminAudit"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "SuspiciousActivity_dismissedAt_raisedAt_idx" ON "SuspiciousActivity"("dismissedAt", "raisedAt");

-- CreateIndex
CREATE INDEX "SuspiciousActivity_raisedAt_lastSeenAt_idx" ON "SuspiciousActivity"("raisedAt", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuspiciousActivity_kind_subjectId_windowStart_key" ON "SuspiciousActivity"("kind", "subjectId", "windowStart");

-- CreateIndex
CREATE INDEX "ContactRequest_status_createdAt_idx" ON "ContactRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "SecurityNotice_status_createdAt_idx" ON "SecurityNotice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WelcomeNotice_status_createdAt_idx" ON "WelcomeNotice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccountLoginSession_userId_expiresAt_idx" ON "AccountLoginSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AccountLoginSession_expiresAt_idx" ON "AccountLoginSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_kind_idx" ON "AuthToken"("userId", "kind");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Organization_workspaceOwnerId_idx" ON "Organization"("workspaceOwnerId");

-- CreateIndex
CREATE INDEX "WorkspaceTransfer_fromUserId_status_idx" ON "WorkspaceTransfer"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceTransfer_toUserId_status_idx" ON "WorkspaceTransfer"("toUserId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceCustomRole_organizationId_idx" ON "WorkspaceCustomRole"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceCustomRole_organizationId_name_key" ON "WorkspaceCustomRole"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_organizationId_providerId_label_key" ON "ProviderAccount"("organizationId", "providerId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "EncryptedCredential_providerAccountId_key" ON "EncryptedCredential"("providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSyncState_providerAccountId_key" ON "ProviderSyncState"("providerAccountId");

-- CreateIndex
CREATE INDEX "SyncJob_providerAccountId_status_idx" ON "SyncJob"("providerAccountId", "status");

-- CreateIndex
CREATE INDEX "SyncJob_status_createdAt_id_idx" ON "SyncJob"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProviderJobReview_membershipId_idx" ON "ProviderJobReview"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJobItem_jobId_domainName_key" ON "SyncJobItem"("jobId", "domainName");

-- CreateIndex
CREATE INDEX "Domain_organizationId_deletedAt_name_idx" ON "Domain"("organizationId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "Domain_organizationId_deletedAt_status_idx" ON "Domain"("organizationId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Domain_organizationId_tld_status_idx" ON "Domain"("organizationId", "tld", "status");

-- CreateIndex
CREATE INDEX "Domain_organizationId_createdAt_idx" ON "Domain"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_organizationId_name_key" ON "Domain"("organizationId", "name");

-- CreateIndex
CREATE INDEX "DomainRegistration_expiresAt_idx" ON "DomainRegistration"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DomainRegistration_domainId_registrar_key" ON "DomainRegistration"("domainId", "registrar");

-- CreateIndex
CREATE INDEX "DomainListing_providerAccountId_status_idx" ON "DomainListing"("providerAccountId", "status");

-- CreateIndex
CREATE INDEX "DomainListing_marketplace_status_statusCheckedAt_idx" ON "DomainListing"("marketplace", "status", "statusCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DomainListing_domainId_marketplace_key" ON "DomainListing"("domainId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "DomainTag_organizationId_name_key" ON "DomainTag"("organizationId", "name");

-- CreateIndex
CREATE INDEX "DomainExpense_domainId_currency_idx" ON "DomainExpense"("domainId", "currency");

-- CreateIndex
CREATE INDEX "DomainRenewal_domainId_currency_idx" ON "DomainRenewal"("domainId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderChange_syncJobId_key" ON "ProviderChange"("syncJobId");

-- CreateIndex
CREATE INDEX "ProviderChange_organizationId_status_createdAt_idx" ON "ProviderChange"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DomainSale_soldAt_idx" ON "DomainSale"("soldAt");

-- CreateIndex
CREATE INDEX "DomainSale_domainId_status_idx" ON "DomainSale"("domainId", "status");

-- CreateIndex
CREATE INDEX "SalePayment_currency_receivedAt_idx" ON "SalePayment"("currency", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalePayment_saleId_reference_key" ON "SalePayment"("saleId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "SaleInstallment_saleId_sequence_key" ON "SaleInstallment"("saleId", "sequence");

-- CreateIndex
CREATE INDEX "Commission_saleId_currency_idx" ON "Commission"("saleId", "currency");

-- CreateIndex
CREATE INDEX "FinancialAdjustment_saleId_currency_idx" ON "FinancialAdjustment"("saleId", "currency");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceActivityRead_membershipId_idx" ON "WorkspaceActivityRead"("membershipId");

-- CreateIndex
CREATE INDEX "NotificationRead_membershipId_idx" ON "NotificationRead"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "ActivityNotice_status_createdAt_idx" ON "ActivityNotice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityNotice_ownerId_reservedAt_idx" ON "ActivityNotice"("ownerId", "reservedAt");

-- CreateIndex
CREATE INDEX "RenewalReminder_status_createdAt_idx" ON "RenewalReminder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalReminder_organizationId_ownerId_weekStart_key" ON "RenewalReminder"("organizationId", "ownerId", "weekStart");

-- CreateIndex
CREATE INDEX "AuthThrottle_resetAt_idx" ON "AuthThrottle"("resetAt");

-- CreateIndex
CREATE INDEX "SpaceshipRequestBudget_updatedAt_idx" ON "SpaceshipRequestBudget"("updatedAt");

-- CreateIndex
CREATE INDEX "ProviderSaleObservation_providerAccountId_observedAt_idx" ON "ProviderSaleObservation"("providerAccountId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSaleObservation_providerAccountId_externalId_key" ON "ProviderSaleObservation"("providerAccountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAnalytics_providerAccountId_date_key" ON "ProviderAnalytics"("providerAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ListingPriceChange_syncJobId_key" ON "ListingPriceChange"("syncJobId");

-- CreateIndex
CREATE INDEX "ListingPriceChange_organizationId_status_createdAt_idx" ON "ListingPriceChange"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ListingPriceChange_notificationGroup_idx" ON "ListingPriceChange"("notificationGroup");

-- CreateIndex
CREATE INDEX "PublicRegistrationJob_status_createdAt_idx" ON "PublicRegistrationJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "OAuthSignupPending" ADD CONSTRAINT "OAuthSignupPending_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityNotice" ADD CONSTRAINT "SecurityNotice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeNotice" ADD CONSTRAINT "WelcomeNotice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLoginSession" ADD CONSTRAINT "AccountLoginSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_workspaceOwnerId_fkey" FOREIGN KEY ("workspaceOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTransfer" ADD CONSTRAINT "WorkspaceTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTransfer" ADD CONSTRAINT "WorkspaceTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTransfer" ADD CONSTRAINT "WorkspaceTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "WorkspaceCustomRole"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceCustomRole" ADD CONSTRAINT "WorkspaceCustomRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncryptedCredential" ADD CONSTRAINT "EncryptedCredential_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSyncState" ADD CONSTRAINT "ProviderSyncState_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJobReview" ADD CONSTRAINT "ProviderJobReview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJobReview" ADD CONSTRAINT "ProviderJobReview_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJobItem" ADD CONSTRAINT "SyncJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationError" ADD CONSTRAINT "IntegrationError_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainRegistration" ADD CONSTRAINT "DomainRegistration_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainRegistration" ADD CONSTRAINT "DomainRegistration_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainListing" ADD CONSTRAINT "DomainListing_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainListing" ADD CONSTRAINT "DomainListing_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainPriceHistory" ADD CONSTRAINT "DomainPriceHistory_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainTag" ADD CONSTRAINT "DomainTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainTagAssignment" ADD CONSTRAINT "DomainTagAssignment_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainTagAssignment" ADD CONSTRAINT "DomainTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "DomainTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainNote" ADD CONSTRAINT "DomainNote_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainExpense" ADD CONSTRAINT "DomainExpense_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainRenewal" ADD CONSTRAINT "DomainRenewal_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderChange" ADD CONSTRAINT "ProviderChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderChange" ADD CONSTRAINT "ProviderChange_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderChange" ADD CONSTRAINT "ProviderChange_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderChange" ADD CONSTRAINT "ProviderChange_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainVerification" ADD CONSTRAINT "DomainVerification_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainSale" ADD CONSTRAINT "DomainSale_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "DomainSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInstallment" ADD CONSTRAINT "SaleInstallment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "DomainSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "DomainSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAdjustment" ADD CONSTRAINT "FinancialAdjustment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "DomainSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceActivityRead" ADD CONSTRAINT "WorkspaceActivityRead_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "AuditLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceActivityRead" ADD CONSTRAINT "WorkspaceActivityRead_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityNotice" ADD CONSTRAINT "ActivityNotice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalReminder" ADD CONSTRAINT "RenewalReminder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalReminder" ADD CONSTRAINT "RenewalReminder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSaleObservation" ADD CONSTRAINT "ProviderSaleObservation_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAnalytics" ADD CONSTRAINT "ProviderAnalytics_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPriceChange" ADD CONSTRAINT "ListingPriceChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPriceChange" ADD CONSTRAINT "ListingPriceChange_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPriceChange" ADD CONSTRAINT "ListingPriceChange_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "DomainListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPriceChange" ADD CONSTRAINT "ListingPriceChange_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicRegistrationJob" ADD CONSTRAINT "PublicRegistrationJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Search, integrity, and deployment settings.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Domain_name_search_idx" ON "Domain" USING gin ("name" gin_trgm_ops);
CREATE INDEX "DomainSale_domainId_idx" ON "DomainSale" ("domainId");
CREATE INDEX "Commission_saleId_idx" ON "Commission" ("saleId");
CREATE INDEX "FinancialAdjustment_saleId_idx" ON "FinancialAdjustment" ("saleId");
CREATE INDEX "DomainNote_domainId_idx" ON "DomainNote" ("domainId");
CREATE INDEX "DomainPriceHistory_domainId_createdAt_idx" ON "DomainPriceHistory" ("domainId", "createdAt" DESC);
CREATE INDEX "SalePayment_receivedAt_idx" ON "SalePayment" ("receivedAt");
CREATE UNIQUE INDEX "WorkspaceTransfer_pending_organization_key" ON "WorkspaceTransfer"("organizationId") WHERE "status" = 'pending';
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_nonnegative_cost" CHECK ("acquisitionCost" >= 0 AND ("askingPrice" IS NULL OR "askingPrice" >= 0));
ALTER TABLE "DomainListing" ADD CONSTRAINT "DomainListing_nonnegative_price" CHECK (("binPrice" IS NULL OR "binPrice" >= 0) AND ("minOffer" IS NULL OR "minOffer" >= 0));
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_positive_amount" CHECK ("amount" > 0);
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_nonnegative_amount" CHECK ("amount" >= 0);
ALTER TABLE "WorkspaceTransfer" ADD CHECK ("fromUserId" <> "toUserId"), ADD CHECK ("status" IN ('pending', 'accepted', 'cancelled', 'declined', 'expired'));
ALTER TABLE "RenewalReminder" ADD CHECK ("status" IN ('pending', 'sending', 'sent', 'skipped', 'failed'));
ALTER TABLE "WelcomeNotice" ADD CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'skipped'));
ALTER TABLE "WorkspaceCustomRole" ADD CHECK ("baseRole" IN ('VIEWER', 'EDITOR', 'ADMIN'));
-- Application timestamps and reporting boundaries use UTC on every new connection.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END $$;
