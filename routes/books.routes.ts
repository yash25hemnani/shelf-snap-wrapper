import { Router } from 'express';
import {
  getHealth,
  identifyBooks,
  searchBookByIsbn,
  searchBooks,
} from '../controllers/books.controller';
import { discoverBooks } from '../controllers/discover.controller';
import { verifyFirebaseToken } from '../middleware/auth.middleware';

const router = Router();

router.use(verifyFirebaseToken);

router.get('/wrapper-health', getHealth);
router.post('/identify-books', identifyBooks);
router.post('/discover', discoverBooks);
router.get('/search-books', searchBooks);
router.get('/isbn-search', searchBookByIsbn);

export default router;
