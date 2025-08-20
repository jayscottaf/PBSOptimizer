CREATE TABLE "bid_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"pairing_number" text NOT NULL,
	"month" text NOT NULL,
	"year" integer NOT NULL,
	"junior_holder_seniority" integer NOT NULL,
	"awarded_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"month" text NOT NULL,
	"year" integer NOT NULL,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"bid_package_id" integer,
	"message_type" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"message_data" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairings" (
	"id" serial PRIMARY KEY NOT NULL,
	"bid_package_id" integer NOT NULL,
	"pairing_number" text NOT NULL,
	"effective_dates" text NOT NULL,
	"route" text NOT NULL,
	"credit_hours" numeric(4, 2) NOT NULL,
	"block_hours" numeric(4, 2) NOT NULL,
	"tafb" text NOT NULL,
	"fdp" text,
	"pay_hours" text,
	"sit_edp_pay" numeric(4, 2),
	"carveouts" text,
	"check_in_time" text,
	"deadheads" integer DEFAULT 0,
	"layovers" jsonb,
	"flight_segments" jsonb NOT NULL,
	"full_text_block" text NOT NULL,
	"hold_probability" integer DEFAULT 0,
	"pairing_days" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "user_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pairing_id" integer NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pairing_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"seniority_number" integer NOT NULL,
	"seniority_percentile" integer DEFAULT 50,
	"base" varchar(10) NOT NULL,
	"aircraft" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_bid_package_id_bid_packages_id_fk" FOREIGN KEY ("bid_package_id") REFERENCES "public"."bid_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_bid_package_id_bid_packages_id_fk" FOREIGN KEY ("bid_package_id") REFERENCES "public"."bid_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_calendar_events" ADD CONSTRAINT "user_calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_calendar_events" ADD CONSTRAINT "user_calendar_events_pairing_id_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_pairing_id_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."pairings"("id") ON DELETE no action ON UPDATE no action;