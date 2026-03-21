ALTER TABLE `acp_sessions` ADD COLUMN `execution_mode` text;
ALTER TABLE `acp_sessions` ADD COLUMN `owner_instance_id` text;
ALTER TABLE `acp_sessions` ADD COLUMN `lease_expires_at` integer;
