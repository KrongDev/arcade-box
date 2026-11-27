CREATE TABLE "app"."order_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor" text NOT NULL,
	"detail" jsonb,
	"ledger_id" bigint,
	"admin_action_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_type_check" CHECK ("app"."order_events"."type" in ('created', 'verified', 'completed', 'granted', 'refunded', 'revoked', 'canceled', 'failed', 'note')),
	CONSTRAINT "order_events_from_status_check" CHECK ("app"."order_events"."from_status" is null or "app"."order_events"."from_status" in ('pending', 'completed', 'refunded', 'canceled', 'failed')),
	CONSTRAINT "order_events_to_status_check" CHECK ("app"."order_events"."to_status" is null or "app"."order_events"."to_status" in ('pending', 'completed', 'refunded', 'canceled', 'failed')),
	CONSTRAINT "order_events_actor_check" CHECK ("app"."order_events"."actor" in ('user', 'system', 'store', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "app"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"payment_method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"product_name" text NOT NULL,
	"product_kind" text NOT NULL,
	"price_amount" bigint NOT NULL,
	"price_currency" text NOT NULL,
	"store_sku" text,
	"store_order_id" text,
	"store_purchase_token" text,
	"store_environment" text,
	"raw_receipt" jsonb,
	"entitlement_id" bigint,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "orders_payment_method_check" CHECK ("app"."orders"."payment_method" in ('coin', 'google_play', 'app_store')),
	CONSTRAINT "orders_status_check" CHECK ("app"."orders"."status" in ('pending', 'completed', 'refunded', 'canceled', 'failed')),
	CONSTRAINT "orders_price_amount_check" CHECK ("app"."orders"."price_amount" >= 0),
	CONSTRAINT "orders_price_currency_check" CHECK (("app"."orders"."payment_method" = 'coin') = ("app"."orders"."price_currency" = 'COIN')),
	CONSTRAINT "orders_completed_at_check" CHECK ("app"."orders"."status" not in ('completed', 'refunded') or "app"."orders"."completed_at" is not null),
	CONSTRAINT "orders_refunded_at_check" CHECK (("app"."orders"."status" = 'refunded') = ("app"."orders"."refunded_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_events" ADD CONSTRAINT "order_events_ledger_id_coin_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "app"."coin_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_events" ADD CONSTRAINT "order_events_admin_action_id_admin_actions_id_fk" FOREIGN KEY ("admin_action_id") REFERENCES "app"."admin_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "app"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_id_id_idx" ON "app"."order_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "order_events_ledger_id_idx" ON "app"."order_events" USING btree ("ledger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_payment_method_store_order_id_key" ON "app"."orders" USING btree ("payment_method","store_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idempotency_key" ON "app"."orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_user_id_created_at_idx" ON "app"."orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_entitlement_id_idx" ON "app"."orders" USING btree ("entitlement_id");