ALTER TABLE "accounts" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('asset', 'liability', 'income', 'expense'));--> statement-breakpoint
DROP TYPE "public"."account_type";