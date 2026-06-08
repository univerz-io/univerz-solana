// src/routes/layerZeroRoutes.ts
import { Router } from "express";
import { getTransferOptions } from "../controllers/layerZeroController";

const router = Router();

// This creates an endpoint at GET /api/layerzero/options
router.get("/options", getTransferOptions);

export default router;