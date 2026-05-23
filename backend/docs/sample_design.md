# Inventory Reservation System Design

Build a small full-stack inventory reservation system.

## Backend

Use FastAPI with SQLite storage. The SQLite database file must be resolved relative to the generated backend source file, not the process working directory. Enable CORS for the local frontend.

### Domain Rules

The system tracks products and temporary reservations.

- A product has `sku`, `name`, `total_stock`, `available_stock`, and `created_at`.
- A reservation has `reservation_id`, `sku`, `quantity`, `status`, and `created_at`.
- `sku` and `reservation_id` are unique non-empty strings.
- `total_stock` must be a positive integer. `available_stock` starts equal to `total_stock`.
- A reservation can only be created when requested `quantity <= available_stock`.
- Creating a reservation immediately reduces `available_stock`.
- Releasing an active reservation changes its status to `released` and restores stock.
- Committing an active reservation changes its status to `committed` and does not restore stock.
- Released or committed reservations cannot be released or committed again.
- The database starts empty. Do not seed or hardcode products or reservations.

## API Endpoints

All endpoints return JSON.

1. `POST /products`
   - Creates a product from `sku`, `name`, and `total_stock`.
   - Returns `201 Created` with the full product including `available_stock` and `created_at`.
   - Returns `400 Bad Request` for missing fields, duplicate `sku`, or non-positive stock.

2. `GET /products/{sku}`
   - Returns `200 OK` with the matching product.
   - Returns `404 Not Found` when the product does not exist.

3. `GET /products`
   - Returns `200 OK` with all products sorted by `created_at` ascending.

4. `POST /reservations`
   - Creates an active reservation from `reservation_id`, `sku`, and `quantity`.
   - Returns `201 Created` with the reservation and the product's updated `available_stock`.
   - Returns `400 Bad Request` when quantity is invalid, stock is insufficient, or `reservation_id` is duplicate.
   - Returns `404 Not Found` when the product does not exist.

5. `POST /reservations/{reservation_id}/release`
   - Releases an active reservation and restores the reserved quantity to the product.
   - Returns `200 OK` with the updated reservation and updated product stock.
   - Returns `400 Bad Request` when the reservation is not active and `404 Not Found` when missing.

6. `POST /reservations/{reservation_id}/commit`
   - Commits an active reservation without restoring stock.
   - Returns `200 OK` with the updated reservation and product stock.
   - Returns `400 Bad Request` when the reservation is not active and `404 Not Found` when missing.

7. `GET /reservations`
   - Returns `200 OK` with all reservations sorted by `created_at` ascending.

## Frontend

Build a React/Vite dashboard that reads the backend port from `config.json` and uses real `fetch()` calls only. It must never render fake fallback products or reservations.

The UI must include:

- A product creation form for `sku`, `name`, and `total_stock`.
- A product inventory table loaded from `GET /products`.
- A reservation form for `reservation_id`, `sku`, and `quantity`.
- A reservation table loaded from `GET /reservations`.
- Release and commit controls for active reservations that call the matching backend endpoints.
- Visible empty states when no products or reservations exist.
- Clear error messaging for validation failures, insufficient stock, missing products, and backend offline states.

## Required Contract

The architect must write `generated_project/contract.json` with every endpoint above. It must include executable valid payloads for at least:

- Creating a product with stock `10`.
- Reading that product by `sku`.
- Listing products.
- Creating a reservation for quantity `4`.
- Listing reservations.
- Releasing one active reservation.
- Committing a second active reservation.

The contract must also describe negative cases for insufficient stock, duplicate product SKU, duplicate reservation ID, non-positive stock, non-positive quantity, missing product, and repeated release or commit of a non-active reservation.

## Required Verification

Generated backend tests must create random SKUs and reservation IDs through the API, then prove:

- Creating a product returns `available_stock == total_stock`.
- Reserving quantity `4` from stock `10` returns `available_stock == 6`.
- Attempting to reserve quantity `7` while only `6` are available fails with `400`.
- Releasing the active reservation restores `available_stock == 10`.
- Committing a separate reservation for quantity `4` leaves `available_stock == 6`.
- Product detail and product list responses reflect the same persisted stock values.
- Reservation list responses include every reservation created during the test with the correct statuses.
- Duplicate IDs, invalid quantities, missing products, and repeated terminal-state transitions fail with expected status codes.

E2E verification must start the real backend and frontend, run the product and reservation lifecycle against the backend API, confirm persisted state through list/detail reads, confirm the frontend serves successfully, and fail if any generated code uses seeded data or hardcoded frontend records.
