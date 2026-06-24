-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'office_manager', 'project_worker', 'task_worker');

-- CreateEnum
CREATE TYPE "ClientRating" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('draft', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "InquiryFormStatus" AS ENUM ('draft', 'submitted', 'cancelled');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('lead', 'pricing', 'signed', 'planning', 'submission', 'execution', 'completed', 'collection_completed', 'cancelled', 'waiting', 'rejected');

-- CreateEnum
CREATE TYPE "ProjectFormStatus" AS ENUM ('draft', 'submitted');

-- CreateEnum
CREATE TYPE "ConstructionStatus" AS ENUM ('not_updated', 'licensing_and_permit_process', 'building_permit_received', 'execution_excavation_and_shoring', 'execution_walls_and_ceilings', 'execution_commissioning_and_activation', 'delivered_to_client');

-- CreateEnum
CREATE TYPE "WorkflowOrigin" AS ENUM ('none', 'native', 'legacy_bootstrap', 'manual');

-- CreateEnum
CREATE TYPE "WorkflowEntryStage" AS ENUM ('unmanaged', 'proposal', 'proposal_followup', 'work_stages', 'invoice', 'collection', 'completed_no_reminders', 'construction_policy');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('draft', 'submitted', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkStageStatus" AS ENUM ('pending', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoiceScope" AS ENUM ('general', 'stage', 'multiple_stages', 'final_project');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('created', 'sent', 'viewed', 'partial', 'paid');

-- CreateEnum
CREATE TYPE "CollectionDueStatus" AS ENUM ('open', 'partially_paid', 'awaiting_tax_invoice', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('active', 'resolved', 'cancelled', 'snoozed');

-- CreateEnum
CREATE TYPE "ReminderFrequency" AS ENUM ('immediate', 'daily', 'weekly', 'due_date_based', 'custom');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'sent', 'pending', 'negotiation', 'signed', 'cancelled');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('quote', 'contract', 'invoice', 'drawing', 'photo', 'other');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL DEFAULT '',
    "role" "UserRole" NOT NULL DEFAULT 'task_worker',
    "phone" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "business_number" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "rating" "ClientRating" NOT NULL DEFAULT 'B',
    "document_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ClientStatus" NOT NULL DEFAULT 'completed',
    "source_inquiry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "id" UUID NOT NULL,
    "client_name" TEXT,
    "building_type" TEXT,
    "area" DOUBLE PRECISION,
    "cooling_tons" DOUBLE PRECISION,
    "details" TEXT,
    "form_status" "InquiryFormStatus" NOT NULL DEFAULT 'draft',
    "copied_to_ai_at" TEXT,
    "submitted_at" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "client_id" UUID,
    "bid_number" TEXT,
    "work_number" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "project_type" TEXT,
    "area" TEXT,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'lead',
    "form_status" "ProjectFormStatus" NOT NULL DEFAULT 'submitted',
    "source_inquiry_id" UUID,
    "source_signed_proposal_id" UUID,
    "year" INTEGER,
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "collected_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "start_date" TEXT,
    "end_date" TEXT,
    "notes" TEXT,
    "collection_due_now" BOOLEAN NOT NULL DEFAULT false,
    "collection_due_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "collection_due_note" TEXT,
    "collection_due_date" TEXT,
    "collection_due_target_date" TEXT,
    "last_collection_paid_on" TEXT,
    "collection_events" JSONB NOT NULL DEFAULT '[]',
    "construction_status" "ConstructionStatus" NOT NULL DEFAULT 'not_updated',
    "construction_status_note" TEXT NOT NULL DEFAULT '',
    "construction_status_updated_at" TEXT NOT NULL DEFAULT '',
    "workflow_managed" BOOLEAN NOT NULL DEFAULT false,
    "workflow_origin" "WorkflowOrigin" NOT NULL DEFAULT 'none',
    "workflow_entry_stage" "WorkflowEntryStage" NOT NULL DEFAULT 'unmanaged',
    "workflow_onboarded_at" TEXT,
    "workflow_onboarding_note" TEXT,
    "workflow_historical_exemptions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "client_id" UUID,
    "client_name" TEXT,
    "project_id" UUID,
    "project_name" TEXT,
    "source_inquiry_id" UUID,
    "proposal_sent_to_client" BOOLEAN NOT NULL DEFAULT false,
    "proposal_sent_at" TEXT,
    "client_saw_proposal" BOOLEAN NOT NULL DEFAULT false,
    "client_saw_at" TEXT,
    "document_note" TEXT,
    "form_status" "FormStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signed_proposals" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "project_name" TEXT,
    "client_id" UUID,
    "client_name" TEXT,
    "has_signed_offer_or_order" BOOLEAN NOT NULL DEFAULT false,
    "signed_at" TEXT,
    "document_note" TEXT,
    "form_status" "FormStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TEXT,
    "source_inquiry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "signed_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_stages" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "project_name" TEXT,
    "client_id" UUID,
    "client_name" TEXT,
    "signed_proposal_id" UUID,
    "title" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "aaron_approved" BOOLEAN NOT NULL DEFAULT false,
    "client_approved" BOOLEAN NOT NULL DEFAULT false,
    "draftsman_approved" BOOLEAN NOT NULL DEFAULT false,
    "target_date" TEXT,
    "invoice_required_on_completion" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkStageStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "completed_at" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_processes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "project_name" TEXT,
    "client_id" UUID,
    "client_name" TEXT,
    "work_stage_ids" TEXT,
    "work_stage_titles" TEXT,
    "invoice_scope" "InvoiceScope" NOT NULL DEFAULT 'general',
    "project_percent" DOUBLE PRECISION,
    "invoice_created_in_paperless" BOOLEAN NOT NULL DEFAULT false,
    "invoice_created_at" TEXT,
    "invoice_sent_to_client" BOOLEAN NOT NULL DEFAULT false,
    "invoice_sent_at" TEXT,
    "client_confirmed_received" BOOLEAN NOT NULL DEFAULT false,
    "client_confirmed_at" TEXT,
    "invoice_reference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "collection_due_id" UUID,
    "form_status" "FormStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "invoice_number" TEXT,
    "date" TEXT NOT NULL,
    "due_date" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'created',
    "amount" DOUBLE PRECISION NOT NULL,
    "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "milestone" TEXT,
    "file_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_dues" (
    "id" UUID NOT NULL,
    "invoice_process_id" UUID,
    "invoice_reference" TEXT,
    "project_id" UUID NOT NULL,
    "project_name" TEXT,
    "client_id" UUID,
    "client_name" TEXT,
    "amount_due" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remaining_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "due_date" TEXT,
    "opened_at" TEXT,
    "paid_at" TEXT,
    "payment_received" BOOLEAN NOT NULL DEFAULT false,
    "payment_received_at" TEXT,
    "tax_invoice_sent_to_client" BOOLEAN NOT NULL DEFAULT false,
    "tax_invoice_sent_at" TEXT,
    "tax_invoice_reference" TEXT,
    "status" "CollectionDueStatus" NOT NULL DEFAULT 'open',
    "source_type" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" UUID,
    "migrated_at" TEXT,
    "migration_note" TEXT,
    "work_stage_ids" TEXT,
    "work_stage_titles" TEXT,
    "notes" TEXT,
    "form_status" "FormStatus" NOT NULL DEFAULT 'submitted',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "collection_dues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "project_name" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "opened_at" TEXT,
    "paid_at" TEXT,
    "type" TEXT NOT NULL DEFAULT 'collection_paid',
    "is_legacy" BOOLEAN NOT NULL DEFAULT false,
    "date_precision" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "collection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "client_name" TEXT NOT NULL,
    "client_id" UUID,
    "project_name" TEXT,
    "project_id" UUID,
    "assigned_to_user_id" UUID,
    "assigned_to_name" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "condition_key" TEXT NOT NULL,
    "action_url" TEXT NOT NULL,
    "action_label" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'active',
    "frequency" "ReminderFrequency" NOT NULL DEFAULT 'daily',
    "default_time" TEXT NOT NULL DEFAULT '07:00',
    "next_remind_at" TEXT,
    "last_reminded_at" TEXT,
    "active_since" TEXT,
    "is_snoozed" BOOLEAN NOT NULL DEFAULT false,
    "snoozed_until" TEXT,
    "reactivated_at" TEXT,
    "reactivation_count" INTEGER NOT NULL DEFAULT 0,
    "future_email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TEXT,
    "resolved_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "daily_reminder_time" TEXT NOT NULL DEFAULT '07:00',
    "daily_reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "related_project_name" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "assigned_to" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "quote_number" TEXT,
    "date" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "items" JSONB NOT NULL DEFAULT '[]',
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payment_milestones" JSONB NOT NULL DEFAULT '[]',
    "validity_days" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "file_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'other',
    "file_url" TEXT NOT NULL,
    "upload_date" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "with_whom" TEXT,
    "summary" TEXT,
    "decisions" TEXT,
    "tasks_created" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
