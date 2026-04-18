# College Project

A full-stack document digitization system that converts real paper tables from photos or scans into structured PostgreSQL data. It uses `gemini-3-flash-preview` model from Google to extract rows and columns, then lets data be organized, edited, and exported through a web dashboard in formats like CSV, JSON, and XLSX.

## Apps

- `apps/website` - frontend built with React, Vite, and TanStack
- `apps/backend` - backend built with Bun, Hono, Drizzle, and Better Auth

## Tech Stack

- `React`
- `Vite`
- `Bun`
- `Hono`
- `Drizzle ORM`
- `PostgreSQL`
- `Zod`
- `pnpm` workspaces

## Getting Started

### Requirements

- `Node.js`
- `pnpm`
- `Bun`
- `Docker`

### Install

```bash
pnpm install
```

### Run the project

```bash
pnpm dev
```

This starts the workspace in development mode and brings up the Docker services used by the project.

## Useful Scripts

```bash
pnpm dev
pnpm lint
pnpm format
pnpm update
```

## Project Structure

```text
├── apps
│   ├── backend
│   └── website
├── package.json
└── README.md
```

## Team

Aman Chand

Raksha Karn

Aayusha Dhakal
