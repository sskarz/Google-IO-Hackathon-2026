# User Profile Dashboard System Design

This microservice handles user profile storage and retrieval, and provides a web dashboard for administrative operations.

## Backend Service

### Data Schema
A user profile consists of:
- `user_id`: unique string identifier (e.g. "user_123")
- `username`: string, non-empty (e.g. "alice")
- `email`: valid email string (e.g. "alice@example.com")
- `created_at`: timestamp string

### API Endpoints
All endpoints return JSON responses.
1. `GET /profile/{user_id}`: Returns profile matching user_id. 404 if not found.
2. `POST /profile`: Creates profile. Custom success response status code `210`. Validates username and email format. Returns created profile.

---

## Frontend Dashboard (UI)

A single-page web dashboard built using React, styled with Tailwind CSS.

### Requirements:
1. **Host Site**: Must be served locally.
2. **Retrieve profiles**: Query the Backend API GET endpoint to retrieve user profile data by input user_id.
3. **Display profile card**: Render profile details (Username, Email, Created At, ID) dynamically in a clean, modern grid layout.
4. **Create profile form**: An interactive form matching the POST schema allowing users to insert new profiles dynamically. Updates dashboard state upon completion.
5. **Aesthetics**: Premium, modern interface with transitions, glassmorphic cards, responsive grid, clean typography, and interactive hover animations.
