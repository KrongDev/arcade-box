CREATE TABLE "app"."board_records" (
	"board_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"best_value" double precision,
	"best_at" timestamp with time zone,
	"best_seconds" double precision,
	"cleared_at" timestamp with time zone,
	"play_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "board_records_board_id_user_id_pk" PRIMARY KEY("board_id","user_id"),
	CONSTRAINT "board_records_play_count_check" CHECK ("app"."board_records"."play_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."boards" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"label" text NOT NULL,
	"ordering" text NOT NULL,
	"min_value" double precision NOT NULL,
	"max_value" double precision NOT NULL,
	"max_coins_per_run" integer NOT NULL,
	"requires_board_id" text,
	"validator" text DEFAULT 'caps' NOT NULL,
	"validator_params" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "boards_id_check" CHECK ("app"."boards"."id" ~ '^[a-z][a-z0-9.-]{1,63}$'),
	CONSTRAINT "boards_ordering_check" CHECK ("app"."boards"."ordering" in ('higher', 'lower')),
	CONSTRAINT "boards_range_check" CHECK ("app"."boards"."min_value" > '-Infinity' and "app"."boards"."min_value" <= "app"."boards"."max_value" and "app"."boards"."max_value" < 'Infinity'),
	CONSTRAINT "boards_max_coins_per_run_check" CHECK ("app"."boards"."max_coins_per_run" >= 0),
	CONSTRAINT "boards_requires_check" CHECK ("app"."boards"."requires_board_id" <> "app"."boards"."id")
);
--> statement-breakpoint
CREATE TABLE "app"."runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"board_id" text NOT NULL,
	"value" double precision,
	"seconds" double precision,
	"won" boolean,
	"coins" integer NOT NULL,
	"ledger_id" bigint,
	"game_version" integer,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_coins_check" CHECK ("app"."runs"."coins" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."board_records" ADD CONSTRAINT "board_records_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "app"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."board_records" ADD CONSTRAINT "board_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."boards" ADD CONSTRAINT "boards_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "app"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."boards" ADD CONSTRAINT "boards_requires_board_id_boards_id_fk" FOREIGN KEY ("requires_board_id") REFERENCES "app"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."runs" ADD CONSTRAINT "runs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "app"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."runs" ADD CONSTRAINT "runs_ledger_id_coin_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "app"."coin_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_records_board_id_best_value_idx" ON "app"."board_records" USING btree ("board_id","best_value");--> statement-breakpoint
CREATE INDEX "board_records_user_id_idx" ON "app"."board_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "boards_game_id_idx" ON "app"."boards" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_user_idempotency_key" ON "app"."runs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "runs_user_id_id_idx" ON "app"."runs" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "runs_ledger_id_idx" ON "app"."runs" USING btree ("ledger_id");