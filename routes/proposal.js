import express from "express";
const router = express.Router();
import {
  redecideProposal,
  indexProposal,
} from "../controllers/proposalController.js";

router.post("/redecide/:proposalId", redecideProposal);
router.post("/index/:daoId/:proposalId", indexProposal);

export default router;
