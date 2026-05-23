# User Profile Service Design

This microservice handles user profile storage and retrieval.

## Data Schema
A user profile consists of:
- `user_id`: unique string identifier (e.g. "user_123")
- `username`: string, non-empty (e.g. "alice")
- `email`: valid email string (e.g. "alice@example.com")
- `created_at`: timestamp string

## API Endpoints

### 1. GET /profile/{user_id}
- Response Code: 200 OK
- Response Body: JSON object matching user profile
- Error Codes: 404 Not Found if user_id doesn't exist

### 2. POST /profile
- Request Body: JSON object with `user_id`, `username`, `email`
- Response Code: 201 Created
- Response Body: JSON object matching user profile
- Error Codes: 400 Bad Request if missing fields or invalid email
