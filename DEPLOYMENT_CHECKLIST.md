# Deployment Checklist

## Issues to Fix

1. **Path Mismatch**: Nginx uses `/srv/spares/dist` but GitHub Actions deploy to `/var/www/spares.tccnc.club/`
2. **Port Mismatch**: Nginx proxies to port `3016` but backend defaults to `3001`
3. **Systemd Services**: Need to be created and configured

## Step-by-Step Deployment Setup

### 1. Create Server Directories

SSH into your server and run:

```bash
# Create directories matching nginx config
sudo mkdir -p /srv/spares/{frontend,backend}
sudo mkdir -p /srv/spares/backend/data

# Set ownership (replace 'youruser' with your actual username)
sudo chown -R youruser:youruser /srv/spares

# Create symlink structure that matches deployment
# Frontend dist will go to /srv/spares/frontend/dist
# Backend dist will go to /srv/spares/backend/dist
```

### 2. Update GitHub Actions Workflows

The workflows need to deploy to `/srv/spares/` instead of `/var/www/spares.tccnc.club/`.

Update `.github/workflows/deploy-production.yml`:
- Change `TARGET` from `/var/www/spares.tccnc.club/` to `/srv/spares/`
- Update the restart script path

Update `.github/workflows/deploy-staging.yml` similarly (if using staging).

### 3. Create Systemd Service File

Create `/etc/systemd/system/spares-production.service`:

```ini
[Unit]
Description=Triangle Curling Spares - Production
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/srv/spares/backend
Environment=NODE_ENV=production
Environment=PORT=3016
EnvironmentFile=/srv/spares/backend/.env
ExecStart=/usr/bin/node /srv/spares/backend/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 4. Set Up Environment File

Create `/srv/spares/backend/.env`:

```env
PORT=3016
NODE_ENV=production
FRONTEND_URL=https://spares.tccnc.club

# Database config will be in db-config.json (created via install UI)
# But you can set a default SQLite path if needed:
# DATABASE_PATH=/srv/spares/backend/data/spares.sqlite

JWT_SECRET=<generate-a-long-random-secret-here>

# These are now optional since we use db-config.json for admins
# But can be used as fallback:
# SERVER_ADMINS=admin@example.com

AZURE_COMMUNICATION_CONNECTION_STRING=<your-azure-connection-string>
AZURE_COMMUNICATION_SENDER_EMAIL=noreply@tccnc.club

TWILIO_ACCOUNT_SID=<your-twilio-account-sid>
TWILIO_AUTH_TOKEN=<your-twilio-auth-token>
TWILIO_PHONE_NUMBER=+1234567890
```

Set permissions:
```bash
sudo chmod 600 /srv/spares/backend/.env
sudo chown www-data:www-data /srv/spares/backend/.env
```

### 5. Set Up Database Config Directory

The backend expects `db-config.json` in `backend/data/`:

```bash
sudo mkdir -p /srv/spares/backend/data
sudo chown www-data:www-data /srv/spares/backend/data
sudo chmod 755 /srv/spares/backend/data
```

### 6. Configure GitHub Secrets

Go to your GitHub repository: Settings → Secrets and variables → Actions

Add these secrets:

- **SSH_PRIVATE_KEY**: Your SSH private key (see step 7)
- **SSH_USER**: Your SSH username (e.g., `ubuntu`, `trevor`, etc.)
- **PROD_HOST**: Your server's IP address or hostname
- **STAGING_HOST**: Same as PROD_HOST if using same server (or different for staging)

### 7. Generate SSH Key for GitHub Actions

On your local machine:

```bash
# Generate a new SSH key for deployments
ssh-keygen -t ed25519 -C "github-actions@spares.tccnc.club" -f ~/.ssh/github_actions_spares

# Copy the PUBLIC key to your server
ssh-copy-id -i ~/.ssh/github_actions_spares.pub youruser@your-server

# Or manually add to server:
cat ~/.ssh/github_actions_spares.pub | ssh youruser@your-server "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Then copy the **PRIVATE** key content:
```bash
cat ~/.ssh/github_actions_spares
```

Paste this entire output as the `SSH_PRIVATE_KEY` secret in GitHub.

### 8. Enable and Start Systemd Service

```bash
# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable spares-production

# Start the service
sudo systemctl start spares-production

# Check status
sudo systemctl status spares-production

# View logs
sudo journalctl -u spares-production -f
```

### 9. Update GitHub Actions Workflows

Update the deployment paths in both workflow files to match `/srv/spares/`.

### 10. Test Deployment

Push to `main` branch and watch the GitHub Actions workflow. After deployment:

```bash
# Check if files were deployed
ls -la /srv/spares/

# Check service status
sudo systemctl status spares-production

# Check logs
sudo journalctl -u spares-production -n 50
```

### 11. Initial Database Setup

After first deployment, visit `https://spares.tccnc.club/install` to configure the database.

## Quick Reference Commands

```bash
# Restart service
sudo systemctl restart spares-production

# View logs
sudo journalctl -u spares-production -f

# Check status
sudo systemctl status spares-production

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

