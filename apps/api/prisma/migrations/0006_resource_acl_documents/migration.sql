-- The previous ResourceAcl table was a placeholder and had no public writer.
-- Abort instead of silently discarding data if it was populated manually.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "resource_acls" LIMIT 1) THEN
        RAISE EXCEPTION 'resource_acls contains legacy rows; migrate them manually before applying 0006';
    END IF;
END $$;

DROP TABLE "resource_acls";

CREATE TYPE "ResourceType" AS ENUM ('DOCUMENT');
CREATE TYPE "AclSubjectType" AS ENUM ('MEMBERSHIP', 'ROLE');
CREATE TYPE "DocumentVisibility" AS ENUM ('PRIVATE', 'TENANT');

CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ResourceType" NOT NULL,
    "owner_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "managed_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "managed_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resource_acls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "subject_type" "AclSubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "permission_codes" TEXT[] NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "resource_acls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resources_tenant_id_type_owner_membership_id_idx" ON "resources"("tenant_id", "type", "owner_membership_id");
CREATE INDEX "managed_documents_tenant_id_visibility_created_at_idx" ON "managed_documents"("tenant_id", "visibility", "created_at");
CREATE UNIQUE INDEX "resource_acls_tenant_id_resource_id_subject_type_subject_id_key" ON "resource_acls"("tenant_id", "resource_id", "subject_type", "subject_id");
CREATE INDEX "resource_acls_tenant_id_resource_id_idx" ON "resource_acls"("tenant_id", "resource_id");
CREATE INDEX "resource_acls_tenant_id_subject_type_subject_id_idx" ON "resource_acls"("tenant_id", "subject_type", "subject_id");
CREATE INDEX "resource_acls_permission_codes_idx" ON "resource_acls" USING GIN ("permission_codes");

ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resources" ADD CONSTRAINT "resources_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_id_fkey" FOREIGN KEY ("id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_acls" ADD CONSTRAINT "resource_acls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_acls" ADD CONSTRAINT "resource_acls_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
