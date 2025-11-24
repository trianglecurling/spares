# Deployment Guide for Triangle Curling Spares

This document provides instructions for setting up and deploying the Triangle Curling Spares application to Azure VM.

## Prerequisites

- Azure VM running Ubuntu 20.04 or later
- Nginx installed and configured
- SSL certificate for *.tccnc.club
- Node.js 20+ installed
- PM2 or systemd for process management

## Server Setup

### 1. Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build tools
sudo apt-get install -y build-essential

# Install PM2 (optional, or use systemd)
sudo npm install -g pm2
```

### 2. Create Application Directories

```bash
# Create directories for both environments
sudo mkdir -p /var/www/spares.tccnc.club
sudo mkdir -p /var/www/spares-preview.tccnc.club

# Create data directories for SQLite databases
sudo mkdir -p /var/www/spares.tccnc.club/backend/data
sudo mkdir -p /var/www/spares-preview.tccnc.club/backend/data

# Set ownership
sudo chown -R $USER:$USER /var/www/spares.tccnc.club
sudo chown -R $USER:$USER /var/www/spares-preview.tccnc.club
```

### 3. Configure Nginx

Create `/etc/nginx/sites-available/spares.tccnc.club`:

```nginx
# Production
server {
    listen 80;
    listen [::]:80;
    server_name spares.tccnc.club;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name spares.tccnc.club;

    ssl_certificate /etc/ssl/certs/tccnc.club.crt;
    ssl_certificate_key /etc/ssl/private/tccnc.club.key;

    # Frontend - serve static files
    location / {
        root /var/www/spares.tccnc.club/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Staging
server {
    listen 80;
    listen [::]:80;
    server_name spares-preview.tccnc.club;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name spares-preview.tccnc.club;

    ssl_certificate /etc/ssl/certs/tccnc.club.crt;
    ssl_certificate_key /etc/ssl/private/tccnc.club.key;

    # Frontend - serve static files
    location / {
        root /var/www/spares-preview.tccnc.club/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/spares.tccnc.club /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Create Systemd Service Files

Create `/etc/systemd/system/spares-production.service`:

```ini
[Unit]
Description=Triangle Curling Spares - Production
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/spares.tccnc.club/backend
Environment=NODE_ENV=production
EnvironmentFile=/var/www/spares.tccnc.club/backend/.env
ExecStart=/usr/bin/node /var/www/spares.tccnc.club/backend/dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/spares-staging.service`:

```ini
[Unit]
Description=Triangle Curling Spares - Staging
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/spares-preview.tccnc.club/backend
Environment=NODE_ENV=production
EnvironmentFile=/var/www/spares-preview.tccnc.club/backend/.env
ExecStart=/usr/bin/node /var/www/spares-preview.tccnc.club/backend/dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable spares-production
sudo systemctl enable spares-staging
sudo systemctl start spares-production
sudo systemctl start spares-staging
```

### 5. Configure Environment Variables

You can copy the template file and edit it:

```bash
cp /var/www/spares.tccnc.club/backend/env.template /var/www/spares.tccnc.club/backend/.env
```

Or create `/var/www/spares.tccnc.club/backend/.env` directly:

```env
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://spares.tccnc.club

DATABASE_PATH=/var/www/spares.tccnc.club/backend/data/spares.sqlite

JWT_SECRET=<generate-a-long-random-secret>

SPARES_ADMINS=admin@example.com,another.admin@example.com

AZURE_COMMUNICATION_CONNECTION_STRING=<your-azure-connection-string>
AZURE_COMMUNICATION_SENDER_EMAIL=noreply@tccnc.club

TWILIO_ACCOUNT_SID=<your-twilio-account-sid>
TWILIO_AUTH_TOKEN=<your-twilio-auth-token>
TWILIO_PHONE_NUMBER=+1234567890
```

Create `/var/www/spares-preview.tccnc.club/backend/.env` with PORT=3002 and staging settings.

Set proper permissions:

```bash
sudo chmod 600 /var/www/spares.tccnc.club/backend/.env
sudo chmod 600 /var/www/spares-preview.tccnc.club/backend/.env
sudo chown www-data:www-data /var/www/spares.tccnc.club/backend/.env
sudo chown www-data:www-data /var/www/spares-preview.tccnc.club/backend/.env
```

## GitHub Configuration

### 1. Add Repository Secrets

Go to your GitHub repository settings → Secrets and variables → Actions, and add:

- `SSH_PRIVATE_KEY`: Your SSH private key for connecting to the server
- `SSH_USER`: The SSH username (e.g., `ubuntu` or your user)
- `PROD_HOST`: Production server hostname or IP
- `STAGING_HOST`: Staging server hostname or IP (can be same as PROD_HOST)

### 2. SSH Key Setup

Generate an SSH key pair for deployments:

```bash
ssh-keygen -t ed25519 -C "github-actions@spares.tccnc.club" -f ~/.ssh/github_actions
```

Add the public key to your server's `~/.ssh/authorized_keys`:

```bash
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
```

Copy the private key content and add it as the `SSH_PRIVATE_KEY` secret in GitHub.

### 3. Branch Setup

- `main` branch → Production (spares.tccnc.club)
- `preview` branch → Staging (spares-preview.tccnc.club)

## Initial Deployment

### Manual First Deployment

1. Build the application locally:

```bash
npm install
npm run build
```

2. Copy files to server:

```bash
# Production
scp -r frontend/dist backend/dist backend/package.json backend/package-lock.json user@server:/var/www/spares.tccnc.club/

# Staging
scp -r frontend/dist backend/dist backend/package.json backend/package-lock.json user@server:/var/www/spares-preview.tccnc.club/
```

3. Install dependencies on server:

```bash
ssh user@server
cd /var/www/spares.tccnc.club/backend
npm install --production

cd /var/www/spares-preview.tccnc.club/backend
npm install --production
```

4. Initialize databases:

```bash
cd /var/www/spares.tccnc.club/backend
node dist/db/migrate.js

cd /var/www/spares-preview.tccnc.club/backend
node dist/db/migrate.js
```

5. Start services:

```bash
sudo systemctl start spares-production
sudo systemctl start spares-staging
```

## Continuous Deployment

After the initial setup, deployments happen automatically:

1. Push to `main` branch → Deploys to production
2. Push to `preview` branch → Deploys to staging

Monitor deployments in the GitHub Actions tab.

## Monitoring

Check service status:

```bash
# Check if services are running
sudo systemctl status spares-production
sudo systemctl status spares-staging

# View logs
sudo journalctl -u spares-production -f
sudo journalctl -u spares-staging -f
```

## Troubleshooting

### Service won't start

```bash
# Check logs
sudo journalctl -u spares-production -n 50

# Verify file permissions
ls -la /var/www/spares.tccnc.club/

# Test the backend manually
cd /var/www/spares.tccnc.club/backend
node dist/index.js
```

### Database issues

```bash
# Check database file exists and is writable
ls -la /var/www/spares.tccnc.club/backend/data/

# Set correct permissions
sudo chown www-data:www-data /var/www/spares.tccnc.club/backend/data/spares.sqlite
sudo chmod 644 /var/www/spares.tccnc.club/backend/data/spares.sqlite
```

### Nginx issues

```bash
# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

## Backup Strategy

### Database Backups

Create a cron job to backup the SQLite database:

```bash
# Create backup script
cat > /usr/local/bin/backup-spares-db.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
cp /var/www/spares.tccnc.club/backend/data/spares.sqlite /var/backups/spares-$DATE.sqlite
# Keep only last 30 days
find /var/backups/spares-*.sqlite -mtime +30 -delete
EOF

chmod +x /usr/local/bin/backup-spares-db.sh

# Add to crontab (daily at 2 AM)
echo "0 2 * * * /usr/local/bin/backup-spares-db.sh" | sudo crontab -
```

## Security Considerations

1. Keep Node.js and system packages updated
2. Use strong JWT secrets (64+ characters)
3. Restrict database file permissions (600 or 644)
4. Keep `.env` files secure (600 permissions)
5. Use HTTPS only (enforce in nginx)
6. Regularly review admin user list in `.env`
7. Monitor logs for suspicious activity

## Updating the Application

For manual updates:

```bash
# SSH to server
ssh user@server

# Pull latest code (if using git on server)
cd /var/www/spares.tccnc.club
git pull origin main

# Or upload new dist files via scp

# Restart services
sudo systemctl restart spares-production
sudo systemctl restart spares-staging
```

