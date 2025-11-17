import express from "express";
const router = express.Router();
import { redecideProposal } from "../controllers/proposalController.js";

router.post("/redecide/:proposalId", redecideProposal);

export default router;
