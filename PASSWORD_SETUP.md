# Setting Dashboard Password

## Option 1: Using Wrangler Secrets (Recommended for Production)

Set the password as a secret (encrypted, not visible in wrangler.toml):

```bash
pnpm exec wrangler secret put DASHBOARD_PASSWORD
```

You'll be prompted to enter your password. This is the most secure method.

## Option 2: Using wrangler.toml (For Development)

Add to your `wrangler.toml`:

```toml
[vars]
DASHBOARD_PASSWORD = "your-secure-password"
```

**Note:** This stores the password in plain text. Don't commit this to git.

## Option 3: Using .env (Local Development Only)

Create a `.env` file:

```
DASHBOARD_PASSWORD=your-secure-password
```

Then run:
```bash
pnpm dev
```

The `.env` file is gitignored and only works for local development.

## Using the Extension

After setting the password:

1. Open the extension
2. Click the settings gear icon
3. Enter your Worker URL
4. Enter the same password you set above
5. Click "Save & Connect"

The extension will now send the password with every API request using Basic Authentication.

## How It Works

- All dashboard and API endpoints (`/`, `/list`, `/new`, `/s/:id`, `/d/:id`) require authentication
- The tracking pixel endpoint (`/t/:id`) does NOT require auth (so emails can load the pixel)
- Uses HTTP Basic Authentication with empty username and your password
- If no password is set, all endpoints are open (backward compatible)
