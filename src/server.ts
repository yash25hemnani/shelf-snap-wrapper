import 'dotenv/config';

import app from './app';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`ShelfSnap Groq API listening on http://localhost:${PORT}`);
});
