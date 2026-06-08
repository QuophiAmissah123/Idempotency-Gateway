import express, { Request, Response } from 'express';
import { idempotencyMiddleware } from './middleware';

const app = express();

app.use(express.json());

// Helper function to simulate a processing delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.post(
  '/process-payment',
  idempotencyMiddleware,
  async (req: Request, res: Response): Promise<any> => {
    const { amount, currency } = req.body;

    // Simple request payload validation
    if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid or missing amount. Must be a positive number.' });
    }

    if (!currency || typeof currency !== 'string' || currency.trim() === '') {
      return res.status(400).json({ error: 'Invalid or missing currency. Must be a non-empty string.' });
    }

    try {
      // Simulate payment processing (2-second delay as per acceptance criteria)
      await delay(2000);

      // Return successful response
      return res.status(200).json({
        message: `Charged ${amount} ${currency}`
      });
    } catch (err) {
      console.error('Payment processing failed:', err);
      return res.status(500).json({ error: 'Internal Server Error during payment processing.' });
    }
  }
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

export default app;
