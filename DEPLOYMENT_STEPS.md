# Complete Deployment Steps

## Summary

I've updated your GitHub Actions workflows to deploy to `/srv/spares/` to match your nginx configuration. Here's what you need to do:

## Step 1: Create Server Directories

SSH into your server and run:

```bash
# Create directories
sudo mkdir -p /srv/spares/{dist,backend/data}
sudo chown -R $USER:$USER /srv/spares
```

## Step 2: Create Systemd Service

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

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable spares-production
```

## Step 3: Create Environment File

Create `/srv/spares/backend/.env`:

```env
PORT=3016
NODE_ENV=production
FRONTEND_URL=https://spares.tccnc.club

JWT_SECRET=<generate-a-long-random-secret-here>

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
sudo chown -R www-data:www-data /srv/spares/backend/data
```

## Step 4: Generate SSH Key for GitHub Actions

On your **local machine**:

```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "github-actions@spares.tccnc.club" -f ~/.ssh/github_actions_spares

# Copy public key to server
ssh-copy-id -i ~/.ssh/github_actions_spares.pub youruser@your-server-ip

# Display private key (copy this entire output)
cat ~/.ssh/github_actions_spares
```

## Step 5: Configure GitHub Secrets

Go to: `https://github.com/trianglecurling/spares/settings/secrets/actions`

Click "New repository secret" and add:

1. **SSH_PRIVATE_KEY**: Paste the entire output from `cat ~/.ssh/github_actions_spares` (includes `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`)

2. **SSH_USER**: Your SSH username (e.g., `ubuntu`, `trevor`, etc.)

3. **PROD_HOST**: Your server's IP address or hostname (e.g., `spares.tccnc.club` or `123.45.67.89`)

4. **STAGING_HOST**: Same as PROD_HOST if using same server (or different for staging)

## Step 6: Test SSH Access from GitHub Actions

You can test the SSH connection manually:

```bash
# On your local machine, test with the private key
ssh -i ~/.ssh/github_actions_spares youruser@your-server-ip
```

If this works, GitHub Actions will be able to connect.

## Step 7: First Deployment

After setting up secrets, push to `main` branch:

```bash
git add .
git commit -m "Update deployment workflows"
git push origin main
```

Watch the deployment in GitHub Actions tab: `https://github.com/trianglecurling/spares/actions`

## Step 8: After First Deployment

After the workflow completes:

1. **Check files were deployed**:
   ```bash
   ls -la /srv/spares/dist/
   ls -la /srv/spares/backend/dist/
   ```

2. **Install backend dependencies** (if not done automatically):
   ```bash
   cd /srv/spares/backend
   npm install --production
   ```

3. **Start the service**:
   ```bash
   sudo systemctl start spares-production
   sudo systemctl status spares-production
   ```

4. **Check logs**:
   ```bash
   sudo journalctl -u spares-production -f
   ```

5. **Visit the install page**: `https://spares.tccnc.club/install` to configure your database

## Step 9: Verify Everything Works

1. Visit `https://spares.tccnc.club` - should show the app
2. Visit `https://spares.tccnc.club/api/health` - should return `{"status":"ok"}`
3. Check nginx logs: `sudo tail -f /var/log/nginx/spares_error.log`
4. Check backend logs: `sudo journalctl -u spares-production -f`

## Troubleshooting

### Service won't start
```bash
# Check logs
sudo journalctl -u spares-production -n 50

# Test manually
cd /srv/spares/backend
node dist/index.js
```

### Permission issues
```bash
sudo chown -R www-data:www-data /srv/spares
sudo chmod 755 /srv/spares/backend/data
```

### Port already in use
```bash
# Check what's using port 3016
sudo lsof -i :3016

# Or change PORT in .env file
```

### Nginx issues
```bash
# Test config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Check error logs
sudo tail -f /var/log/nginx/spares_error.log
```

## Quick Reference

```bash
# Restart service
sudo systemctl restart spares-production

# View logs
sudo journalctl -u spares-production -f

# Check status
sudo systemctl status spares-production

# Test nginx
sudo nginx -t && sudo systemctl reload nginx
```

