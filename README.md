<div align="center">
  <img src="static/original.png" alt="WebOTP Logo" width="128">
  <h1>WebOTP</h1>
  <p><strong>Zero-Knowledge Cloud OTP Vault</strong></p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2.0-FF3E00?logo=svelte)](https://kit.svelte.dev/)
[![Better Auth](https://img.shields.io/badge/Better_Auth-1.0-000000?logo=auth0)](https://better-auth.com/)

<p>
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

</div>

**WebOTP** is a secure, open-source Two-Factor Authentication (2FA) application built with a strict **Zero-Knowledge Architecture**. It allows users to sync their OTP accounts across devices via the cloud, without the server ever having access to the user's secrets or passwords.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started (Local Development)](#getting-started-local-development)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Database Setup](#database-setup)
  - [Running the App](#running-the-app)
- [Deployment](#deployment)
  - [Option 1: Vercel + Neon (Serverless)](#option-1-vercel--neon-serverless)
  - [Option 2: Self-Hosted (Docker)](#option-2-self-hosted-docker)
- [Usage Guide](#usage-guide)
- [Security Model](#security-model)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Zero-Knowledge Architecture**: All encryption happens client-side. The server only stores encrypted blobs and cannot read your OTP secrets.
- **Cloud Sync**: Seamlessly sync accounts across multiple devices.
- **Offline Support**: Full functionality offline using IndexedDB. Changes sync automatically when back online.
- **Biometric Unlock**: Unlock your vault using Face ID, Touch ID, or Windows Hello via WebAuthn PRF extension.
- **Disaster Recovery**: Recover your vault using a 64-character Recovery Key if you forget your master password.
- **TOTP Generation**: Standard RFC 6238 TOTP support.
- **Import/Export**: Import from Google Authenticator, Aegis, 2FAS, and plain text. Export to JSON.
- **PWA Support**: Install as a standalone app on mobile and desktop.
- **Multi-Language**: Supports English and Chinese (i18n).

## Architecture

WebOTP implements a "Trust No One" model. The server acts as a blind storage provider.

### Key Derivation

1.  **Master Password (MP)**: The user's primary secret.
2.  **Double Derivation**:
    - **LAK (Login Authentication Key)**: Derived via PBKDF2. Used to authenticate with the server (Better Auth).
    - **DEK (Data Encryption Key)**: Derived via PBKDF2. Used to encrypt/decrypt the vault locally.
3.  **Salts**: `loginSalt` and `dataSalt` are generated upon registration and stored on the server.

### Encryption

- **Algorithm**: AES-256-GCM.
- **Storage**: The vault is stored as a blob (`v=1;iv=...;ct=...`) in PostgreSQL.
- **Sync**: Uses Optimistic Concurrency Control (OCC) with versioning and 3-way merging to handle conflicts.

### Recovery

- A random 256-bit Recovery Key is generated during registration.
- The DEK is encrypted with a key derived from the Recovery Key (`REK`) and stored on the server.

## Tech Stack

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) (Svelte 5 Runes), [Tailwind CSS](https://tailwindcss.com/), [DaisyUI](https://daisyui.com/).
- **Backend**: SvelteKit Endpoints (Node.js).
- **Database**: [PostgreSQL](https://www.postgresql.org/) with [Drizzle ORM](https://orm.drizzle.team/).
- **Authentication**: [Better Auth](https://better-auth.com/).
- **Cryptography**: Native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API).
- **Local Storage**: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via `idb`).

## Getting Started (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v8 or higher)
- [PostgreSQL](https://www.postgresql.org/) database

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/webotp.git
   cd webotp
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

### Configuration

Create a `.env` file in the root directory:

```env
# Database Connection (Required)
DATABASE_URL="postgresql://user:password@localhost:5432/webotp"

# Better Auth Configuration (Required)
# A random string used to encrypt session tokens. Generate using: openssl rand -base64 32
BETTER_AUTH_SECRET="your-super-secret-key-at-least-32-chars-long"

# Public URL of your application (Required for WebAuthn and Cookies)
# Use http://localhost:5173 for local development
BETTER_AUTH_URL="http://localhost:5173"

# Optional: Production URL if different from BETTER_AUTH_URL
# PUBLIC_URL="https://your-domain.com"
```

### Database Setup

Push the database schema using Drizzle Kit:

```bash
pnpm db:push
```

### Running the App

Start the development server:

```bash
pnpm dev
```

The app should now be running at `http://localhost:5173`.

> **Note**: WebAuthn (Passkeys) requires HTTPS in production. For local development, the project uses `@vitejs/plugin-basic-ssl` to provide a self-signed certificate. You may need to tell your browser to trust the certificate.

## Deployment

### Option 1: Vercel + Neon (Serverless)

This is the recommended way to deploy WebOTP quickly for free.

1.  **Fork the Repository**: Fork this project to your GitHub account.
2.  **Create a Neon Project**:
    - Go to [Neon](https://neon.tech) and create a new project.
    - Copy the **Connection string** (it starts with `postgresql://...`).
3.  **Deploy to Vercel**:
    - Click the button below to import your forked repository:
      [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/webotp)
    - Alternatively, create a new project in Vercel and import your repository manually.
4.  **Set Environment Variables**:
    In the Vercel project settings, add the following Environment Variables:
    - `DATABASE_URL`: Paste the connection string from Neon.
    - `BETTER_AUTH_SECRET`: Generate a random string (at least 32 characters).
    - `BETTER_AUTH_URL`: Your Vercel deployment URL (e.g., `https://webotp.vercel.app`). **Do not** add a trailing slash.
5.  **Push Database Schema**:
    Before the app can work, you need to create the database tables.
    - Run this command locally (replace the URL with your Neon connection string):
      ```bash
      DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/webotp?sslmode=require" pnpm db:push
      ```
6.  **Redeploy**: Trigger a redeploy on Vercel if necessary.

### Option 2: Self-Hosted (Docker)

You can deploy this application using Docker. We recommend using Docker Compose to manage both the application and the database.

#### 1. Create a `docker-compose.yml` file

Create a `docker-compose.yml` file in the root of the project (or on your server):

```yaml
version: "3.8"

services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: webotp
      POSTGRES_PASSWORD: your_secure_password_here
      POSTGRES_DB: webotp
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U webotp"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    image: node:20-alpine
    working_dir: /app
    restart: always
    environment:
      # Connect to the internal docker service 'db'
      DATABASE_URL: postgresql://webotp:your_secure_password_here@db:5432/webotp
      # CHANGE THIS to a random string
      BETTER_AUTH_SECRET: your-super-secret-key-at-least-32-chars-long
      # CHANGE THIS to your actual domain
      BETTER_AUTH_URL: https://your-domain.com
      NODE_ENV: production
    ports:
      - "3000:3000"
    command: sh -c "npm install -g pnpm && pnpm install --frozen-lockfile && pnpm db:push && pnpm build && node build"
    volumes:
      - .:/app
    depends_on:
      db:
        condition: service_healthy

volumes:
  postgres_data:
```

#### 2. Run the container

```bash
docker-compose up -d
```

The application will be available at `http://localhost:3000`.

> **Note**: For production, it is highly recommended to place a reverse proxy (like Nginx or Caddy) in front of the app to handle SSL termination.

## Usage Guide

1. **Register**:
   - Create a new account using your email and a strong master password.
   - **Crucial Step**: You will be presented with a **Recovery Key**. Download this key and store it securely offline. This is the **only** way to recover your data if you forget your master password. The server administrators cannot recover it for you.

2. **Login**:
   - Use your email and master password to unlock your vault.
   - If you are on a trusted device, you can enable "Biometric Unlock" (Face ID/Touch ID) in settings to skip password entry.

3. **Add Accounts**:
   - Click the "Add Account" button.
   - Scan a QR code, upload an image, or manually enter the secret key.
   - You can also import data from other authenticator apps (Google Authenticator, Aegis, 2FAS).

4. **Sync**:
   - Your data is automatically synced to the cloud whenever you make changes.
   - If you use multiple devices, changes are merged automatically in the background.

5. **Recovery**:
   - If you forget your password, click "Forgot Password?" on the login screen.
   - Enter your email and the Recovery Key you saved during registration.
   - Set a new password. Your data will be restored, and a new Recovery Key will be generated.

## Security Model

| Threat Vector         | Mitigation                                                                                                                            |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| **Server Breach**     | Database only stores encrypted blobs and hashed auth keys. No secrets are exposed.                                                    |
| **Memory Dump**       | Sensitive `Uint8Array` buffers are wiped with `crypto.getRandomValues()` immediately after use. Keys are marked `extractable: false`. |
| **XSS**               | Strict Content Security Policy (CSP) headers. No `eval()` or inline scripts.                                                          |
| **Password Guessing** | Better Auth provides rate limiting and account lockout mechanisms.                                                                    |
| **Device Loss**       | Use the Recovery Key on a new device to restore access.                                                                               |

## Development

### Scripts

- `pnpm dev`: Start development server.
- `pnpm build`: Build for production.
- `pnpm preview`: Preview production build.
- `pnpm lint`: Lint and format code.
- `pnpm test`: Run unit tests (Vitest).
- `pnpm test:e2e`: Run E2E tests (Playwright).

### Project Structure

```
src/
├── lib/
│   ├── crypto/         # ZK Engine (PBKDF2, AES-GCM, PRF)
│   ├── server/         # Server-side logic (DB, Auth)
│   ├── stores/         # Svelte 5 Runes state management
│   └── utils/          # TOTP logic, helpers
├── routes/
│   ├── api/            # Backend API endpoints
│   ├── login/          # Login page
│   ├── register/       # Registration page
│   └── settings/       # Settings page
└── app.html            # Main HTML template
```

## Contributing

Contributions are welcome! Please read the [CONVENTIONS.md](CONVENTIONS.md) for coding standards and commit guidelines.

1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'feat: add some feature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## License

Distributed under the MIT License. See `LICENSE` for more information.
