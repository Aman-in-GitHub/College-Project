# College Project

A full-stack document digitization system that converts paper tables from photos into structured PostgreSQL data. It uses a Python microservice with PaddleOCR for the default table scan flow with Gemini available as a fallback when needed. Data can then be reviewed, edited, imported into tables, and exported through the web dashboard in formats like CSV, JSON, and XLSX.

## Apps

- `apps/website` - frontend built with React, Vite, and TanStack
- `apps/backend` - backend built with Bun, Hono, Drizzle, and Better Auth
- `apps/fast-api` - python microservice that runs PaddleOCR for table scanning

## Tech Stack

- `React`
- `Vite`
- `Bun`
- `Hono`
- `FastAPI`
- `PaddleOCR`
- `Drizzle ORM`
- `PostgreSQL`
- `Zod`
- `pnpm` workspaces

## Getting Started

### Requirements

- `node 22+`
- `pnpm`
- `bun`
- `docker`
- `uv`
- `python 3.12`

### Install

```bash
pnpm install
```

Install Python dependencies for the OCR microservice:

```bash
cd apps/fast-api
uv sync
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
│   ├── fast-api
│   └── website
├── package.json
└── README.md
```

## Team

Aman Chand

Raksha Karn

Aayusha Dhakal
