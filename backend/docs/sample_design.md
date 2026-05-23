# Online Library Store System Design

Build a full-stack online library store where customers can create accounts, log in, browse books, add books to an order, check out, and review their order history.

## Goals

- Let users register and log in with an email and password.
- Let authenticated users browse a book catalog and search by title, author, or genre.
- Let users add available books to a cart and complete checkout.
- Persist users, books, carts, and orders in a SQL database.
- Use Redis caching to reduce repeated database reads for the public book catalog.
- Provide a React frontend with a book-themed browsing and checkout experience.

## Backend

Use Python for the backend API and a SQL database for persistence. Store password hashes, not raw passwords.

Core data:

- User: id, email, password_hash, display_name, created_at.
- Book: id, title, author, genre, description, price_cents, inventory_count, cover_theme, created_at.
- Cart item: user_id, book_id, quantity.
- Order: id, user_id, status, total_cents, created_at.
- Order item: order_id, book_id, title_snapshot, price_cents, quantity.

Required behavior:

- Registering with a duplicate email should fail.
- Login should return an auth token that can be used for protected requests.
- Catalog browsing should work for unauthenticated visitors.
- Book catalog reads should be cached in Redis and invalidated when book inventory changes.
- Cart and checkout endpoints require authentication.
- Checkout must fail if a requested book is out of stock or requested quantity exceeds inventory.
- Successful checkout creates an order, creates order items, decrements book inventory, clears the cart, and returns the order summary.
- Order history should only show the authenticated user's orders.

## Frontend

Use React for the frontend. The UI should feel like an online bookstore or library, with a catalog-first layout.

Pages and features:

- Account registration and login screens.
- A catalog page with search and genre filtering.
- Book cards showing title, author, price, inventory availability, and a themed cover area.
- A cart view that lets the user update quantities or remove books.
- A checkout action that creates an order and shows a confirmation.
- An order history page showing past orders and item details.
- Clear loading, empty, and error states.

The frontend should use real API calls to the backend and should not render fake fallback books, users, carts, or orders.

## Reliability And Validation

- Database state should start empty except for any explicit seed endpoint or local seed script the generated project documents and tests.
- API validation should return clear JSON errors for duplicate accounts, invalid login, unauthorized cart access, invalid quantities, and insufficient inventory.
- Automated tests should prove registration, login, catalog browsing, cart updates, checkout inventory changes, and order history access.
- End-to-end verification should run the backend and frontend, create a user, add books, check out, and confirm the resulting order and inventory state through real API calls.
