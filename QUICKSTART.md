# Quick Start Guide

This guide will help you get the Triangle Curling Spares application running on your local machine in just a few minutes.

## Prerequisites

Make sure you have installed:
- Node.js 20 or higher
- npm (comes with Node.js)

## Installation Steps

### 1. Install Dependencies

From the project root directory, run:

```bash
npm install
```

This will install all dependencies for both the frontend and backend.

### 2. Configure Environment Variables

Create a `.env` file in the `backend` directory:

```bash
cd backend
cp env.template .env
```

Edit `backend/.env` and update at minimum:

```env
# Required for basic functionality
JWT_SECRET=your-super-secret-jwt-key-change-this-to-something-long-and-random
SPARES_ADMINS=your.email@example.com

# Optional: For email/SMS (can be added later)
# AZURE_COMMUNICATION_CONNECTION_STRING=your-connection-string
# TWILIO_ACCOUNT_SID=your-account-sid
# TWILIO_AUTH_TOKEN=your-auth-token
# TWILIO_PHONE_NUMBER=+1234567890
```

**Note**: Without Azure/Twilio credentials, the app will still work but will log emails/SMS to the console instead of sending them.

### 3. Initialize the Database

```bash
npm run db:migrate --workspace=backend
```

### 4. Start the Development Servers

From the project root:

```bash
npm run dev
```

This starts both the frontend and backend servers:
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## First Steps

### 1. Create Your First Admin User

Since you don't have any members yet, you'll need to add yourself to the database manually:

```bash
# From the backend directory
cd backend
node -e "
const db = require('better-sqlite3')('./data/spares.sqlite');
db.prepare('INSERT INTO members (name, email, is_admin) VALUES (?, ?, ?)').run('Your Name', 'your.email@example.com', 1);
console.log('Admin user created!');
"
```

Or use a SQLite client to insert a member directly.

### 2. Log In

1. Go to http://localhost:5173
2. Enter your email address (the one you just added)
3. You'll see a 6-digit code in the backend console (since email isn't configured yet)
4. Enter that code to log in

### 3. Complete First Login

On your first login, you'll be asked to:
- Confirm your name
- Add/confirm contact info
- Opt in to SMS (optional)

### 4. Set Up Leagues (Admin)

1. Click "Leagues" in the navigation
2. Click "Add League"
3. Create a league with:
   - Name (e.g., "Tuesday Night Mixed")
   - Day of week
   - One or more draw times
   - Format (Teams or Doubles)
   - Start and end dates

### 5. Set Your Availability

1. Click "My Availability" in the navigation
2. Toggle the leagues you're available for
3. Check "Comfortable skipping?" if applicable

### 6. Create a Test Spare Request

1. Go back to Dashboard
2. Click "Request a Spare"
3. Fill out the form
4. Submit

You should see notifications in the backend console.

## Development Tips

### Watch Backend Logs

The backend logs will show:
- API requests
- Auth codes (when email isn't configured)
- Email/SMS content (when services aren't configured)
- Errors and warnings

### Hot Module Replacement (HMR)

The frontend uses Vite's HMR, so your changes will appear instantly without refreshing. The backend uses `tsx watch`, so it automatically restarts when you save changes.

### Database Location

Your SQLite database is at:
```
backend/data/spares.sqlite
```

You can open it with any SQLite client (DB Browser for SQLite, TablePlus, etc.) to inspect or modify data during development.

### Common Issues

**Port already in use**:
- Frontend: Change `server.port` in `frontend/vite.config.ts`
- Backend: Change `PORT` in `backend/.env`

**Database locked**:
- Make sure you don't have the database open in another SQLite client while the backend is running

**Auth token not working**:
- Check that `JWT_SECRET` is set in your `.env` file
- Clear localStorage in your browser and log in again

## Next Steps

Once you're comfortable with the basics:

1. **Add Real Members**: Use the admin interface to add real club members
2. **Configure Email**: Set up Azure Communication Services for real email notifications
3. **Configure SMS**: Set up Twilio for text message notifications
4. **Test All Flows**: Create spare requests, respond to them, manage availability
5. **Customize**: Adjust colors, text, or functionality to match your needs

## Getting Help

- Check [README.md](README.md) for full documentation
- See [QUESTIONS.txt](QUESTIONS.txt) for design decisions and clarifications
- Review [DEPLOYMENT.md](DEPLOYMENT.md) when ready to deploy

## Stopping the Servers

Press `Ctrl+C` in the terminal where you ran `npm run dev`.

---

Happy curling! 🥌

