import { Router } from 'express';
import * as storefrontController from './storefront.controller';
import { requireAdmin } from '../../common/auth.middleware';

export const storefrontRouter = Router();

storefrontRouter.get('/api/store/categories', (req, res) => {
  storefrontController.getCategories(req, res);
});

storefrontRouter.get('/api/store/products', (req, res) => {
  void storefrontController.getProducts(req, res);
});

storefrontRouter.get('/api/store/products/:id', (req, res) => {
  void storefrontController.getProduct(req, res);
});

storefrontRouter.post('/api/store/orders', (req, res) => {
  void storefrontController.postOrder(req, res);
});

storefrontRouter.get('/api/store/orders/:id', (req, res) => {
  void storefrontController.getOrder(req, res);
});

storefrontRouter.post('/api/store/cache/invalidate', requireAdmin, (req, res) => {
  storefrontController.postInvalidateCache(req, res);
});
