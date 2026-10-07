import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import {
    validateListOrdersQuery,
    validateUpdateOrderBody,
} from '../validators/orders.validator.js';
import { getOrder, getOrders, patchOrder } from '../controllers/orders.controller.js';

/**
 * Staff order API (workplan 8.6-8.8). Every route sits behind the shared
 * x-api-key; the staff dashboard and Postman collection consume these.
 */
const router = Router();

router.use(requireApiKey);

router.get('/', validateListOrdersQuery, getOrders);
router.get('/:orderId', getOrder);
router.patch('/:orderId', validateUpdateOrderBody, patchOrder);

export default router;
