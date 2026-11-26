CREATE TABLE "app"."product_prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."product_prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_amount_check" CHECK ("app"."product_prices"."amount" >= 0),
	CONSTRAINT "product_prices_currency_check" CHECK ("app"."product_prices"."currency" in ('COIN', 'KRW'))
);
--> statement-breakpoint
CREATE TABLE "app"."products" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_path" text,
	"game_id" text,
	"slot" text,
	"access" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"consumable" boolean DEFAULT false NOT NULL,
	"grant_coins" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_check" CHECK ("app"."products"."id" ~ '^[a-z][a-z0-9.-]{1,63}$'),
	CONSTRAINT "products_kind_check" CHECK (("app"."products"."kind" = 'game' and "app"."products"."game_id" is not null and "app"."products"."slot" is null and not "app"."products"."consumable" and "app"."products"."grant_coins" is null)
       or ("app"."products"."kind" = 'item' and "app"."products"."game_id" is not null and "app"."products"."slot" is not null and not "app"."products"."consumable" and "app"."products"."grant_coins" is null)
       or ("app"."products"."kind" = 'coin_pack' and "app"."products"."game_id" is null and "app"."products"."slot" is null and "app"."products"."consumable" and "app"."products"."grant_coins" is not null and "app"."products"."grant_coins" > 0)),
	CONSTRAINT "products_access_check" CHECK ("app"."products"."access" in ('everyone', 'purchase')),
	CONSTRAINT "products_status_check" CHECK ("app"."products"."status" in ('draft', 'on_sale', 'hidden', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "app"."store_skus" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."store_skus_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" text NOT NULL,
	"store" text NOT NULL,
	"sku" text NOT NULL,
	CONSTRAINT "store_skus_store_check" CHECK ("app"."store_skus"."store" in ('google_play', 'app_store'))
);
--> statement-breakpoint
ALTER TABLE "app"."product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "app"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."store_skus" ADD CONSTRAINT "store_skus_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_one_active" ON "app"."product_prices" USING btree ("product_id","currency") WHERE "app"."product_prices"."active";--> statement-breakpoint
CREATE INDEX "product_prices_product_id_idx" ON "app"."product_prices" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_one_game_product" ON "app"."products" USING btree ("game_id") WHERE "app"."products"."kind" = 'game';--> statement-breakpoint
CREATE UNIQUE INDEX "store_skus_store_sku" ON "app"."store_skus" USING btree ("store","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "store_skus_product_id_store" ON "app"."store_skus" USING btree ("product_id","store");