include .env
export

TEST_DATABASE_URL ?= postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:$(POSTGRES_PORT)/destekai_test?sslmode=disable

.PHONY: up down reset-db seed token test

up:
	docker compose up --build -d

down:
	docker compose down

# Deletes the database volume, then rebuilds everything from scratch.
reset-db:
	docker compose down -v
	docker compose up --build -d

# Refreshes the demo data and its relative dates.
seed:
	docker compose exec order-api seed

# Usage: make token CUSTOMER=CUS-1002
token:
	docker compose exec order-api devtoken -customer $(or $(CUSTOMER),CUS-1001)

test:
	cd order-api && TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test -count=1 ./...
