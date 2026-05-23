# Google I/O Hackathon 2026 🚀

Welcome to the Google I/O Hackathon 2026 repository! This project is organized as a monorepo containing both the frontend and backend applications.

---

## 📁 Repository Structure

```text
Google-IO-Hackathon-2026/
├── frontend/             # React + TypeScript Frontend (Vite)
│   ├── src/
│   ├── package.json
│   └── .gitignore
├── backend/              # Python Backend (uv)
│   ├── main.py
│   ├── pyproject.toml
│   └── .gitignore
├── .gitignore            # Root gitignore (Editor/OS files)
└── README.md             # Project documentation (This file)
```

---

## 💻 Tech Stack

- **Frontend**: [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **Backend**: [Python](https://www.python.org/) managed by [uv](https://github.com/astral-sh/uv) (fast package installer & resolver)

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [uv](https://github.com/astral-sh/uv) (fast Python package manager)

### Running the Frontend

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```

### Running the Backend

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate virtual environment, install dependencies, and run:
   ```bash
   uv run main.py
   ```
