CREATE TABLE "app"."reward_claims" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."reward_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"claim_date" date NOT NULL,
	"seq" integer NOT NULL,
	"ledger_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_claims_kind_check" CHECK ("app"."reward_claims"."kind" in ('attendance', 'ad_reward')),
	CONSTRAINT "reward_claims_seq_check" CHECK ("app"."reward_claims"."seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "app"."reward_claims" ADD CONSTRAINT "reward_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reward_claims" ADD CONSTRAINT "reward_claims_ledger_id_coin_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "app"."coin_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_claims_user_kind_date_seq" ON "app"."reward_claims" USING btree ("user_id","kind","claim_date","seq");--> statement-breakpoint
CREATE INDEX "reward_claims_ledger_id_idx" ON "app"."reward_claims" USING btree ("ledger_id");