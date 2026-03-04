-- Add branch column to acp_sessions for tracking which git branch the session is scoped to
ALTER TABLE `acp_sessions` ADD `branch` text;
