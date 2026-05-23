# Overview
The system enables users to safely register and log in to a web-based dashboard application. It provides a secure, lightweight, and scalable authentication backend using FastAPI, SQLite/PostgreSQL, and JSON Web Tokens (JWT). The infrastructure is designed to be fully modular, allowing for independent scaling of authentication and dashboard services.

## Goals
- **Secure User Registration:** Allow new users to create accounts with email and password, ensuring password hashing using Argon2/bcrypt.
- **Stateless Authentication:** Verify user identity via secure, short-lived JWT access tokens and longer-lived, HttpOnly refresh tokens.
- **Dashboard Access Control:** Restrict dashboard endpoints to authenticated or authorized users only.
- **Concrete Technical Defaults:** Use FastAPI, SQLite (for development) transitioning to PostgreSQL, and SQLAlchemy ORM for database representation.
- **Developer-Friendly API Documentation:** Automatically expose interactive Swagger UI and ReDoc endpoints.

## Architecture
The system adopts an API-first monolithic architectural style (highly modular) designed for fast, modern deployments:
1. **Frontend Client:** Web dashboard (React/Vue/HTML5) that interacts with APIs via secure HTTPS.
2. **API Gateway / Router (FastAPI):** Orchestrates routing, middleware (CORS, Rate Limiting), and dependency injection.
3. **Authentication Layer:** Deals with credentials verification, password hashing, and token signing/validation.
4. **Data Access Layer:** Uses SQLAlchemy ORM to communicate with the SQLite/PostgreSQL Database.
5. **Database Layer:** Holds the relational data model for users, sessions, and dashboard resources.

```mermaid
graph TD
    User([User / Web Browser]) -->|HTTPS Request| FE[Frontend Client / Dashboard UI]
    FE -->|API Call: JWT in Authorization Header| API[FastAPI Backend Server]
    API -->|1. Route & Middleware| Cors[CORS / Rate Limiting Middleware]
    API -->|2. Process Auth/Data Requests| Controllers[Auth & User Controllers]
    Controllers -->|Authenticate / Verify Token| JWT[JWT Token Utility]
    Controllers -->|Query / Mutate| ORM[SQLAlchemy ORM]
    ORM -->|Read/Write Model| DB[(SQLite / PostgreSQL Database)]
```

## Components
The infrastructure comprises the following Core Components:

1. **User Manager & AuthService:**
   - **Responsibility:** Password hashing (using `passlib` with `bcrypt` backend), access/refresh token generation, and user validation logic.
   - **Core API endpoints:**
     - `POST /api/v1/auth/register` (Payload: `UserCreate` schema)
     - `POST /api/v1/auth/login` (Payload: `OAuth2PasswordRequestForm`)
     - `POST /api/v1/auth/refresh` (Payload: Refresh token)

2. **Dashboard Controller & User Routes:**
   - **Responsibility:** Fetching user-specific dashboard insights and editing profile settings.
   - **Core API endpoints:**
     - `GET /api/v1/users/me` (Protected: Requires valid Bearer Token)
     - `GET /api/v1/dashboard/stats` (Protected: Dashboard data tailored to the logged-in user)

3. **Database Model (`User` Entity):**
   - **Columns:**
     - `id`: `UUID` (Primary Key, uniquely identifies the user)
     - `email`: `String(255)` (Unique, Indexed, used as login identifier)
     - `hashed_password`: `String` (Securely encrypted password hash)
     - `is_active`: `Boolean` (Flags deactivated accounts)
     - `created_at`: `DateTime` (Timestamp of creation)
     - `updated_at`: `DateTime` (Timestamp of last update)

4. **Dependency Injection & Security Rules:**
   - `get_db`: Yields database sessions.
   - `get_current_user`: Dependency that extracts, decodes, and validates the JWT Bearer-Token, fetching the user dynamically.

## Data Flow

### User Registration Flow
```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant API as FastAPI Router
    participant DB as SQLite / PostgreSQL Database
    
    User->>API: POST /api/v1/auth/register (email, password)
    API->>API: Validate input schemas (Pydantic Validation)
    API->>DB: Check if email already exists
    alt Email exists
        DB-->>API: User Record Found
        API-->>User: HTTP 400 Bad Request (Email already registered)
    else Email is unique
        API->>API: Hash password via Bcrypt/Argon2
        API->>DB: Insert new user (email, hashed_password)
        DB-->>API: Return User model
        API-->>User: HTTP 201 Created (user_id, email, is_active)
    end
```

### User Login & Dashboard Access Flow
```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant API as FastAPI Router
    participant DB as SQLite/PostgreSQL DB
    
    User->>API: POST /api/v1/auth/login (email, password)
    API->>DB: Retrieve User record by email
    alt User not found
        DB-->>API: Null
        API-->>User: HTTP 401 Unauthorized (Invalid credentials)
    else User exists
        API->>API: Compare raw password against hashed_password
        alt Password matches
            API->>API: Generate Access JWT (expires in 15m) & Refresh JWT
            API-->>User: HTTP 200 OK (access_token, token_type, refresh_token)
        else Password mismatch
            API-->>User: HTTP 401 Unauthorized (Invalid credentials)
        end
    end
    
    Note over User, API: Accessing Restricted Dashboard
    User->>API: GET /api/v1/dashboard/stats with Bearer [Access Token]
    API->>API: Decode and verify JWT Signature & Expiry
    alt JWT Token invalid or expired
        API-->>User: HTTP 401 Unauthorized (Could not validate credentials)
    else JWT Token is valid
        API->>DB: Fetch specific user dashboard insights
        DB-->>API: Return DB stats
        API-->>User: HTTP 200 OK (Dashboard JSON data payload)
    end
```