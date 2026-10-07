import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import {
    validateListTicketsQuery,
    validateUpdateTicketBody,
} from '../validators/tickets.validator.js';
import { getTicket, getTickets, patchTicket } from '../controllers/tickets.controller.js';

/**
 * Staff ticket API (workplan 8.9-8.11). Every route sits behind the shared
 * x-api-key; the staff dashboard consumes these.
 */
const router = Router();

router.use(requireApiKey);

router.get('/', validateListTicketsQuery, getTickets);
router.get('/:ticketId', getTicket);
router.patch('/:ticketId', validateUpdateTicketBody, patchTicket);

export default router;
