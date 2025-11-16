import express from "express";
const router = express.Router();
import { addChain } from "../controllers/chainController.js";

router.post("/add", addChain);

export default router;
