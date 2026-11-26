CREATE TABLE "app"."game_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."game_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"bundle_path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"signature" text NOT NULL,
	"min_shell_api" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "game_versions_status_check" CHECK ("app"."game_versions"."status" in ('uploaded', 'live', 'withdrawn')),
	CONSTRAINT "game_versions_version_check" CHECK ("app"."game_versions"."version" >= 1),
	CONSTRAINT "game_versions_min_shell_api_check" CHECK ("app"."game_versions"."min_shell_api" >= 1),
	CONSTRAINT "game_versions_size_bytes_check" CHECK ("app"."game_versions"."size_bytes" >= 0),
	CONSTRAINT "game_versions_sha256_check" CHECK ("app"."game_versions"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."games" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_path" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"live_version_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_id_check" CHECK ("app"."games"."id" ~ '^[a-z][a-z0-9-]{1,31}$'),
	CONSTRAINT "games_status_check" CHECK ("app"."games"."status" in ('draft', 'live', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "app"."game_versions" ADD CONSTRAINT "game_versions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "app"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."games" ADD CONSTRAINT "games_live_version_id_game_versions_id_fk" FOREIGN KEY ("live_version_id") REFERENCES "app"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_versions_game_id_version" ON "app"."game_versions" USING btree ("game_id","version");