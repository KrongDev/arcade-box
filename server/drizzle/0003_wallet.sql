CREATE TABLE "app"."coin_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."coin_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reason" text NOT NULL,
	"admin_action_id" bigint,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_ledger_delta_check" CHECK ("app"."coin_ledger"."delta" <> 0),
	CONSTRAINT "coin_ledger_balance_after_check" CHECK ("app"."coin_ledger"."balance_after" >= 0),
	CONSTRAINT "coin_ledger_reason_check" CHECK ("app"."coin_ledger"."reason" in ('run', 'attendance', 'ad_reward', 'purchase', 'refund', 'grant', 'adjust'))
);
--> statement-breakpoint
CREATE TABLE "app"."wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_check" CHECK ("app"."wallets"."balance" >= 0 and "app"."wallets"."balance" <= 9000000000000000)
);
--> statement-breakpoint
ALTER TABLE "app"."coin_ledger" ADD CONSTRAINT "coin_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coin_ledger" ADD CONSTRAINT "coin_ledger_admin_action_id_admin_actions_id_fk" FOREIGN KEY ("admin_action_id") REFERENCES "app"."admin_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_ledger_user_idempotency_key" ON "app"."coin_ledger" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "coin_ledger_user_id_id_idx" ON "app"."coin_ledger" USING btree ("user_id","id");