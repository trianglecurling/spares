import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-key',
  databasePath: process.env.DATABASE_PATH || './data/spares.sqlite',
  
  admins: (process.env.SERVER_ADMINS || '').split(',').map(email => email.trim()).filter(Boolean),
  
  azure: {
    connectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '',
    senderEmail: process.env.AZURE_COMMUNICATION_SENDER_EMAIL || 'noreply@tccnc.club',
  },
  
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  },
};

