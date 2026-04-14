import path from 'path';
import dotenv from 'dotenv';

/** Server repo root `.env` (Mongo, Pancake login, Chrome, etc.). */
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
