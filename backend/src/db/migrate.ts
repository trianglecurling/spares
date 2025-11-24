import { getDatabase, closeDatabase } from './index.js';

console.log('Running database migrations...');
const db = getDatabase();
console.log('Database initialized successfully!');
closeDatabase();

