# Triangle Curling Spares

A web application for Triangle Curling Club members to find and offer spares when unable to make their scheduled games.

## Features

- **Authentication**: Simple email/SMS-based login with 6-digit codes
- **Spare Availability**: Members can set their availability by league and position preferences
- **Spare Requests**: Request spares publicly (all available members) or privately (specific members)
- **Real-time Notifications**: Email and SMS notifications for spare requests and responses
- **Admin Management**: Manage members, leagues, and send welcome emails
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Tech Stack

### Backend
- Node.js with Fastify
- SQLite database with better-sqlite3
- TypeScript
- Azure Communication Services (email)
- Twilio (SMS)
- JWT authentication

### Frontend
- React 18
- TypeScript
- TailwindCSS
- React Router
- Axios

### Development
- Vite (build tool with HMR)
- ESLint & Prettier
- Workspaces (monorepo structure)

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd spares
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:

Copy `backend/env.template` to `backend/.env` and fill in your configuration:

```bash
cp backend/env.template backend/.env
```

Required environment variables:
- `JWT_SECRET`: A long random string for JWT signing
- `SERVER_ADMINS`: Comma-separated list of server admin email addresses
- `AZURE_COMMUNICATION_CONNECTION_STRING`: Azure Communication Services connection string
- `AZURE_COMMUNICATION_SENDER_EMAIL`: Verified sender email address
- `TWILIO_ACCOUNT_SID`: Twilio account SID
- `TWILIO_AUTH_TOKEN`: Twilio auth token
- `TWILIO_PHONE_NUMBER`: Twilio phone number for SMS

### Development

Run both frontend and backend in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
# Frontend (http://localhost:5173)
npm run dev:frontend

# Backend (http://localhost:3001)
npm run dev:backend
```

### Database Setup

Initialize the database:

```bash
npm run db:init --workspace=backend
```

### Building for Production

```bash
npm run build
```

This builds both the frontend and backend.

## Project Structure

```
spares/
├── backend/
│   ├── src/
│   │   ├── db/           # Database schema and migrations
│   │   ├── middleware/   # Auth middleware
│   │   ├── routes/       # API routes
│   │   ├── services/     # Email and SMS services
│   │   ├── utils/        # Utility functions
│   │   ├── config.ts     # Configuration
│   │   ├── types.ts      # TypeScript types
│   │   └── index.ts      # Server entry point
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/   # Reusable components
│   │   ├── contexts/     # React contexts
│   │   ├── pages/        # Page components
│   │   │   └── admin/    # Admin pages
│   │   ├── utils/        # Utility functions
│   │   ├── App.tsx       # Main app component
│   │   ├── main.tsx      # Entry point
│   │   └── index.css     # Global styles
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── .github/
│   └── workflows/        # GitHub Actions for CI/CD
├── DEPLOYMENT.md         # Deployment instructions
├── QUESTIONS.txt         # Questions and clarifications
├── package.json          # Root package.json (workspace)
└── README.md            # This file
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

### Quick Deployment Summary

- **Production**: Push to `main` branch → Deploys to spares.tccnc.club
- **Staging**: Push to `preview` branch → Deploys to spares-preview.tccnc.club

## Admin Setup

### Setting Up First Admin

1. Add your email address to the `SERVER_ADMINS` environment variable in `.env`
2. Restart the backend server
3. Log in using your email address

Admins specified in the `.env` file cannot have their admin rights removed through the UI.

### Admin Capabilities

- Manage members (add, edit, delete, send welcome emails)
- Manage leagues (create, edit, delete leagues and draw times)
- View all spare requests
- Create private spare requests and select specific members

## API Endpoints

### Authentication
- `POST /api/auth/request-code` - Request login code
- `POST /api/auth/verify-code` - Verify login code
- `POST /api/auth/select-member` - Select member (when multiple share contact)
- `GET /api/auth/verify` - Verify JWT token

### Members
- `GET /api/members/me` - Get current member profile
- `PATCH /api/members/me` - Update current member profile
- `POST /api/members/me/complete-first-login` - Complete first login flow
- `POST /api/members/me/unsubscribe` - Unsubscribe from emails
- `GET /api/members` - Get all members (admin only)
- `POST /api/members` - Create member (admin only)
- `PATCH /api/members/:id` - Update member (admin only)
- `DELETE /api/members/:id` - Delete member (admin only)
- `POST /api/members/:id/send-welcome` - Send welcome email (admin only)

### Leagues
- `GET /api/leagues` - Get all leagues
- `POST /api/leagues` - Create league (admin only)
- `PATCH /api/leagues/:id` - Update league (admin only)
- `DELETE /api/leagues/:id` - Delete league (admin only)

### Availability
- `GET /api/availability` - Get current member's availability
- `POST /api/availability/league` - Set availability for a league
- `POST /api/availability/can-skip` - Set skip preference

### Spare Requests
- `GET /api/spares` - Get all open spare requests (public + private invitations)
- `GET /api/spares/my-requests` - Get current member's spare requests
- `POST /api/spares` - Create spare request
- `POST /api/spares/:id/respond` - Respond to spare request
- `POST /api/spares/:id/cancel` - Cancel spare request

## Development Notes

### Code Style

This project uses ESLint and Prettier for code formatting. Run:

```bash
npm run lint      # Check for issues
npm run format    # Auto-format code
```

### Database

The application uses SQLite for simplicity and ease of deployment. The database file is created automatically on first run.

Location:
- Development: `backend/data/spares.sqlite`
- Production: Set via `DATABASE_PATH` environment variable

### Email and SMS

During development, if Azure Communication Services or Twilio credentials are not configured, the application will log the messages to console instead of sending them.

## Support

For questions or issues, please refer to [QUESTIONS.txt](QUESTIONS.txt) or contact the development team.

## License

MIT License - See LICENSE file for details

