include .env
export

TEST_DATABASE_URL ?= postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:$(POSTGRES_PORT)/destekai_test?sslmode=disable

.PHONY: keys up down reset-db seed token test

# The Ed25519 key pair that signs session tokens. Refuses to overwrite an existing key.
keys:
	@test ! -f secrets/jwt_private.pem || (echo "secrets/jwt_private.pem exists; delete it to rotate" && exit 1)
	mkdir -p secrets
	openssl genpkey -algorithm ed25519 -out secrets/jwt_private.pem
	openssl pkey -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem
	@# The containers run as their own users; on Linux they need to read the bind-mounted files.
	chmod 644 secrets/jwt_private.pem secrets/jwt_public.pem

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
	docker compose exec -e JWT_PRIVATE_KEY_FILE=/run/secrets/jwt_private order-api devtoken -customer $(or $(CUSTOMER),CUS-1001)

test:
	cd order-api && TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test -count=1 ./...
