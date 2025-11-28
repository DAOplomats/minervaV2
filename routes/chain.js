import express from "express";
const router = express.Router();
import { addChain, listChains } from "../controllers/chainController.js";

router.post("/add", addChain);
router.get("/list", listChains);

export default router;
