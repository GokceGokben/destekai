-- Runs once, when the Postgres volume is first created.
-- Integration tests truncate tables, so they get their own database.
CREATE DATABASE destekai_test;
