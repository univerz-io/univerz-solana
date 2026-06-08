// src/controllers/layerZeroController.ts
import { Request, Response } from "express";
import { prepareCrossChainOptions } from "../services/layerZeroService";

export async function getTransferOptions(req: Request, res: Response) {
  try {
    const hexOptions = await prepareCrossChainOptions();
    return res.status(200).json({ success: true, extraOptions: hexOptions });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}