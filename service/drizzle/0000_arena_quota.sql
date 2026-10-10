CREATE TABLE `arena_quota` (
  `window_key` text PRIMARY KEY NOT NULL,
  `count` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arena_quota_expiry_idx` ON `arena_quota` (`expires_at`);
