CREATE TABLE "app"."entitlements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."entitlements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"source" text NOT NULL,
	"admin_action_id" bigint,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "entitlements_source_check" CHECK ("app"."entitlements"."source" in ('coin_purchase', 'store_purchase', 'grant')),
	CONSTRAINT "entitlements_revoke_reason_check" CHECK ("app"."entitlements"."revoke_reason" is null or "app"."entitlements"."revoke_reason" in ('refund', 'admin')),
	CONSTRAINT "entitlements_revoked_check" CHECK (("app"."entitlements"."revoked_at" is null) = ("app"."entitlements"."revoke_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "app"."equipped_items" (
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"slot" text NOT NULL,
	"product_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipped_items_user_id_game_id_slot_pk" PRIMARY KEY("user_id","game_id","slot")
);
--> statement-breakpoint
ALTER TABLE "app"."entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entitlements" ADD CONSTRAINT "entitlements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entitlements" ADD CONSTRAINT "entitlements_admin_action_id_admin_actions_id_fk" FOREIGN KEY ("admin_action_id") REFERENCES "app"."admin_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."equipped_items" ADD CONSTRAINT "equipped_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."equipped_items" ADD CONSTRAINT "equipped_items_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "app"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."equipped_items" ADD CONSTRAINT "equipped_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_one_active" ON "app"."entitlements" USING btree ("user_id","product_id") WHERE "app"."entitlements"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "entitlements_user_id_idx" ON "app"."entitlements" USING btree ("user_id");