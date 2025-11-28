import express from "express";
const router = express.Router();
import {
  redecideProposal,
  indexProposal,
  listProposals,
  getProposal,
} from "../controllers/proposalController.js";

router.post("/redecide/:proposalId", redecideProposal);
router.post("/index/:daoId/:proposalId", indexProposal);
router.get("/list", listProposals);
router.get("/get/:proposalId", getProposal);

export default router;
