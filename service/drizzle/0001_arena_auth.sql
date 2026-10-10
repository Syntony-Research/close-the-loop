CREATE TABLE `arena_oauth_states` (
  `state_hash` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `verifier` text NOT NULL,
  `nonce` text NOT NULL,
  `binding_hash` text NOT NULL,
  `challenge` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arena_oauth_states_expiry_idx` ON `arena_oauth_states` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `arena_auth_exchanges` (
  `code_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `user_name` text NOT NULL,
  `provider` text NOT NULL,
  `challenge` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arena_auth_exchanges_expiry_idx` ON `arena_auth_exchanges` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `arena_sessions` (
  `session_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `user_name` text NOT NULL,
  `provider` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arena_sessions_expiry_idx` ON `arena_sessions` (`expires_at`);
